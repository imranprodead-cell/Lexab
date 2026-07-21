/**
 * Агентные воркфлоу (Этап 4) — один сценарий по документу как цепочка шагов:
 * «проверить (сверить с законом) → внести правки по тяжести → отправить на
 * согласование». Оркестратор исполняет шаги последовательно, пишет прогресс в
 * workflow_runs и аудит workflow.* (метаданные шагов, без текста договора).
 *
 *   POST /workflows/run { documentId, steps }  — запустить сценарий (владелец)
 *   GET  /workflows/:id                          — статус/прогресс (поллинг)
 *   GET  /workflows                              — история запусков
 *
 * Каталог шагов фиксирован: analyze / apply-redlines[minSeverity] /
 * send-for-approval[approvers]. Переиспользует общий конвейер анализа
 * (analyzeSource) и хелперы startApprovalFlow / setRedlineStatus — те же, что
 * стоят за интерактивными кнопками, так что регресс исключён их же тестами.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { assertFeature, planHasFeature, planFor, withAiRequest } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { resolveDocumentAccess } from '../lib/teamAccess.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { newId } from '../lib/ids.ts';
import { analyzeSource, persistAnalysis, setRedlineStatus, sourceFromAnalysis } from './analysis.routes.ts';
import { parseApprovalSteps, startApprovalFlow, type ApprovalStepInput } from './approvals.routes.ts';

const SEVERITY_RANK: Record<string, number> = { Low: 1, Medium: 2, High: 3 };

type WorkflowStep =
  | { kind: 'analyze' }
  | { kind: 'apply-redlines'; minSeverity: 'High' | 'Medium' | 'Low' }
  | { kind: 'send-for-approval'; approvers: ApprovalStepInput[] };

interface RunRow {
  id: string;
  user_id: string;
  document_id: string | null;
  analysis_id: string | null;
  status: string;
  steps_json: WorkflowStep[] | string;
  current_step: number;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunWire {
  id: string;
  documentId: string | null;
  analysisId: string | null;
  status: string;
  steps: { kind: string; label: string }[];
  currentStep: number;
  error: string | null;
  createdAt: string;
}

/** Human label for a step (RU) — shown in the progress checklist. */
function stepLabel(step: WorkflowStep): string {
  switch (step.kind) {
    case 'analyze':
      return 'Анализ и сверка с законом';
    case 'apply-redlines':
      return `Принять правки: ${step.minSeverity === 'High' ? 'высокий риск' : step.minSeverity === 'Medium' ? 'средний и выше' : 'все'}`;
    case 'send-for-approval':
      return `Отправить на согласование (${step.approvers.length})`;
  }
}

function runToWire(row: RunRow): RunWire {
  const steps: WorkflowStep[] = typeof row.steps_json === 'string' ? JSON.parse(row.steps_json) : row.steps_json;
  return {
    id: row.id,
    documentId: row.document_id,
    analysisId: row.analysis_id,
    status: row.status,
    steps: steps.map((s) => ({ kind: s.kind, label: stepLabel(s) })),
    currentStep: row.current_step,
    error: row.error,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/** Validate the requested steps against the fixed catalog. */
function parseSteps(raw: unknown): WorkflowStep[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 5) {
    throw badRequest('Поле "steps" — массив из 1–5 шагов сценария');
  }
  const steps: WorkflowStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const obj = asObject(raw[i], `steps[${i}]`);
    const kind = requireString(obj, 'kind', { min: 1, max: 40 });
    if (kind === 'analyze') {
      steps.push({ kind: 'analyze' });
    } else if (kind === 'apply-redlines') {
      const min = typeof obj.minSeverity === 'string' ? obj.minSeverity : 'High';
      if (!['High', 'Medium', 'Low'].includes(min)) throw badRequest(`steps[${i}].minSeverity — High, Medium или Low`);
      steps.push({ kind: 'apply-redlines', minSeverity: min as 'High' | 'Medium' | 'Low' });
    } else if (kind === 'send-for-approval') {
      steps.push({ kind: 'send-for-approval', approvers: parseApprovalSteps(obj.approvers) });
    } else {
      throw badRequest(`Неизвестный шаг «${kind}»`);
    }
  }
  return steps;
}

async function setRun(db: Db, runId: string, fields: Partial<{ status: string; analysis_id: string; current_step: number; error: string }>): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [runId];
  for (const [k, v] of Object.entries(fields)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  await db.query(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = $1`, params);
}

/**
 * Execute a run's steps in order. Each step is transactional/idempotent enough
 * that a failure stops the run with an honest error (no half-hung state) — the
 * analysis it produced, or the redlines it accepted, are already committed and
 * visible. Exported for deterministic tests (autostart disabled by config).
 */
export async function runWorkflow(db: Db, runId: string): Promise<void> {
  const res = await db.query<RunRow>('SELECT * FROM workflow_runs WHERE id = $1', [runId]);
  const run = res.rows[0];
  if (!run) return;
  const userId = run.user_id;
  const documentId = run.document_id;
  const steps: WorkflowStep[] = typeof run.steps_json === 'string' ? JSON.parse(run.steps_json) : run.steps_json;
  await setRun(db, runId, { status: 'running' });

  // The document name — for the approval flow + notifications.
  let docName = 'документ';
  let analysisId = run.analysis_id;
  try {
    if (!documentId) throw new HttpError(400, 'Не указан документ');
    const docRow = await db.query<{ name: string; user_id: string; jurisdiction: string }>(
      'SELECT name, user_id, jurisdiction FROM documents WHERE id = $1 AND deleted_at IS NULL',
      [documentId],
    );
    if (!docRow.rows[0]) throw new HttpError(404, 'Документ не найден');
    docName = docRow.rows[0].name;
    const ownerId = docRow.rows[0].user_id;
    // The document's stored jurisdiction drives RAG retrieval + citation
    // validation in the analyze step — without it analyzeSource would silently
    // skip the law check ('—' is the "unknown" placeholder, not a jurisdiction).
    const docJurisdiction = docRow.rows[0].jurisdiction !== '—' ? docRow.rows[0].jurisdiction : null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await setRun(db, runId, { current_step: i });

      if (step.kind === 'analyze') {
        // Re-analyse the current draft through the shared pipeline (RAG + citation
        // validation + playbook), persisted under the document owner.
        const latest = await db.query<{ id: string }>(
          'SELECT id FROM analyses WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
          [documentId],
        );
        if (!latest.rows[0]) throw new HttpError(400, 'Сначала проанализируйте документ хотя бы один раз');
        const source = await sourceFromAnalysis(db, userId, latest.rows[0].id);
        // sourceFromAnalysis carries no jurisdiction — thread the document's own
        // so the shared pipeline runs RAG + citation validation, exactly like
        // the interactive and batch paths do.
        if (!source.jurisdiction) source.jurisdiction = docJurisdiction;
        const result = await withAiRequest(db, userId, async (plan) => {
          const gen = await analyzeSource(db, userId, source, plan);
          // Долгий шаг анализа мог идти десятки секунд — документ могли удалить
          // за это время. Перепроверяем перед сохранением, чтобы persistAnalysis
          // не воскресил его дублем; иначе честно валим запуск.
          const stillLive = await db.query('SELECT 1 FROM documents WHERE id = $1 AND deleted_at IS NULL', [documentId]);
          if (!stillLive.rows[0]) throw new HttpError(410, 'Документ удалён во время выполнения сценария');
          return persistAnalysis(db, source.ownerUserId ?? ownerId, source, gen, userId);
        });
        analysisId = result.id;
        await setRun(db, runId, { analysis_id: analysisId });
      } else if (step.kind === 'apply-redlines') {
        if (!analysisId) throw new HttpError(400, 'Нет анализа для применения правок — добавьте шаг «Анализ»');
        const threshold = SEVERITY_RANK[step.minSeverity];
        const rls = await db.query<{ id: string; severity: 'High' | 'Medium' | 'Low' }>(
          'SELECT id, severity FROM redlines WHERE analysis_id = $1 ORDER BY ord',
          [analysisId],
        );
        for (const r of rls.rows) {
          if (SEVERITY_RANK[r.severity] >= threshold) await setRedlineStatus(db, analysisId, ownerId, r.id, 'accepted');
        }
      } else if (step.kind === 'send-for-approval') {
        const active = await db.query("SELECT 1 FROM approval_flows WHERE document_id = $1 AND status = 'active'", [documentId]);
        if (active.rows[0]) throw new HttpError(409, 'По документу уже идёт согласование — отмените его перед запуском сценария');
        const owner = await db.query<{ name: string; firm: string }>('SELECT name, firm FROM users WHERE id = $1', [ownerId]);
        await startApprovalFlow(
          db,
          { id: ownerId, name: owner.rows[0]?.name ?? 'LexAI', firm: owner.rows[0]?.firm ?? '' },
          { id: documentId, name: docName },
          step.approvers,
        );
      }

      await audit(db, null, {
        type: 'workflow.step',
        teamOwnerId: ownerId,
        actorId: userId,
        target: { type: 'document', id: documentId, label: docName },
        metadata: { step: step.kind, index: i },
      });
    }

    await setRun(db, runId, { status: 'done', current_step: steps.length });
    await audit(db, null, {
      type: 'workflow.completed',
      teamOwnerId: ownerId,
      actorId: userId,
      target: { type: 'document', id: documentId, label: docName },
      metadata: { steps: steps.length },
    });
    await notify(db, userId, 'check', 'Сценарий выполнен', 'Workflow completed', {
      bodyRu: `${docName} · ${steps.length} шаг(ов)`,
      bodyEn: `${docName} · ${steps.length} step(s)`,
      action: { kind: 'open', data: `/documents/${documentId}` },
    });
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Сценарий прерван из-за ошибки';
    await setRun(db, runId, { status: 'failed', error: message.slice(0, 300) });
    await audit(db, null, {
      type: 'workflow.failed',
      actorId: userId,
      target: { type: 'document', id: documentId ?? undefined, label: docName },
      metadata: { error: message.slice(0, 120) },
    }).catch(() => undefined);
    await notify(db, userId, 'alert', 'Сценарий прерван', 'Workflow failed', {
      bodyRu: `${docName} · ${message.slice(0, 120)}`,
      bodyEn: `${docName} · ${message.slice(0, 120)}`,
      action: documentId ? { kind: 'open', data: `/documents/${documentId}` } : undefined,
    }).catch(() => undefined);
  }
}

/** Boot recovery: запуски, прерванные падением/перезапуском (queued/running на
 *  момент старта), помечаются failed с понятной ошибкой — шаги воркфлоу не
 *  идемпотентны для слепого повтора (анализ списывает ИИ-квоту), поэтому
 *  честный fail + повторный запуск пользователем безопаснее автодоигрывания. */
export async function failInterruptedWorkflows(db: Db): Promise<void> {
  await db.query(
    `UPDATE workflow_runs SET status = 'failed',
            error = 'Прерван перезапуском сервера — запустите сценарий ещё раз', updated_at = now()
     WHERE status IN ('queued', 'running')`,
  );
}

export function workflowRoutes(app: FastifyInstance, db: Db): void {
  app.post('/workflows/run', { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<RunWire> => {
    await assertFeature(db, req.currentUser.id, 'workflows');
    const body = asObject(req.body);
    const documentId = requireString(body, 'documentId', { min: 1, max: 60 });
    const steps = parseSteps(body.steps);

    // Workflows mutate the document and can start an approval chain → owner only.
    const access = await resolveDocumentAccess(db, req.currentUser.id, documentId);
    if (access.access !== 'owner') throw new HttpError(403, 'Сценарий может запустить только владелец документа');
    // A send-for-approval step needs the approvals feature too.
    if (steps.some((s) => s.kind === 'send-for-approval')) {
      const plan = await planFor(db, req.currentUser.id);
      if (!planHasFeature(plan, 'approvals')) throw new HttpError(402, 'Шаг «Согласование» доступен на планах с маршрутами согласования (Pro и Business)');
    }

    const runId = newId('wf');
    await db.query('INSERT INTO workflow_runs (id, user_id, document_id, steps_json, status) VALUES ($1, $2, $3, $4, $5)', [
      runId,
      req.currentUser.id,
      documentId,
      JSON.stringify(steps),
      'queued',
    ]);
    await audit(db, req, {
      type: 'workflow.started',
      target: { type: 'document', id: documentId, label: access.doc.name },
      metadata: { steps: steps.map((s) => s.kind) },
    });

    // Background execution (disabled in tests, which call runWorkflow() directly).
    if (config.batchAutostart) void runWorkflow(db, runId).catch((err) => req.log.error(err, 'workflow run failed'));

    reply.code(201);
    const created = await db.query<RunRow>('SELECT * FROM workflow_runs WHERE id = $1', [runId]);
    return runToWire(created.rows[0]);
  });

  app.get('/workflows', { preHandler: [app.authenticate] }, async (req): Promise<RunWire[]> => {
    await assertFeature(db, req.currentUser.id, 'workflows');
    const res = await db.query<RunRow>('SELECT * FROM workflow_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.currentUser.id]);
    return res.rows.map(runToWire);
  });

  app.get('/workflows/:id', { preHandler: [app.authenticate] }, async (req): Promise<RunWire> => {
    await assertFeature(db, req.currentUser.id, 'workflows');
    const { id } = req.params as { id: string };
    const res = await db.query<RunRow>('SELECT * FROM workflow_runs WHERE id = $1', [id]);
    const run = res.rows[0];
    if (!run || run.user_id !== req.currentUser.id) throw notFound('Запуск сценария не найден');
    return runToWire(run);
  });
}
