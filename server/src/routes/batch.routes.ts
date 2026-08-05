/**
 * Массовый разбор (Этап 3) — пачка договоров одним заданием.
 *
 * Файлы заранее загружены через POST /uploads (переиспользуем хранилище,
 * шифрование, извлечение текста, проверку сигнатуры). POST /batch принимает
 * список uploadId, создаёт задание и в фоне прогоняет каждый файл через общий
 * конвейер анализа (analyzeSource → persistAnalysis) — по одному, best-effort:
 * битый/сверхлимитный файл помечается ошибкой, остальные продолжают. Прогресс —
 * поллингом GET /batch/:id (не SSE: проще и без багов стриминга). Каждый готовый
 * анализ — обычная строка в documents/analyses → попадает в «Документы», CLM и
 * аналитику автоматически.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { fileExtension } from '../extract.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { decTextStrict } from '../lib/docCrypto.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertFeatureTeamAware, withAiRequest } from '../lib/limits.ts';
import { asObject } from '../lib/validate.ts';
import { readFileBytes } from '../storage.ts';
import { analyzeSource, persistAnalysis, type AnalysisSource } from './analysis.routes.ts';
import { renderBatchReportHtml } from '../lib/batchReport.ts';
import { audit } from '../lib/audit.ts';

const MAX_BATCH_FILES = 20;

interface BatchItemWire {
  id: string;
  fileName: string;
  status: string;
  documentId: string | null;
  analysisId: string | null;
  riskScore: number | null;
  riskLevel: string | null;
  findingsCount: number | null;
  error: string | null;
}

interface BatchJobWire {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  items?: BatchItemWire[];
}

interface JobRow {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  created_at: Date | string;
}

interface ItemRow {
  id: string;
  file_name: string;
  status: string;
  document_id: string | null;
  analysis_id: string | null;
  risk_score: number | null;
  risk_level: string | null;
  findings_count: number | null;
  error: string | null;
}

function jobToWire(row: JobRow): BatchJobWire {
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    done: row.done,
    failed: row.failed,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function itemToWire(row: ItemRow): BatchItemWire {
  return {
    id: row.id,
    fileName: row.file_name,
    status: row.status,
    documentId: row.document_id,
    analysisId: row.analysis_id,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    findingsCount: row.findings_count,
    error: row.error,
  };
}

/** Resolve one uploaded file's content by id (owned by the user). Mirrors the
 *  single-analysis resolver: a PRESENT-but-undecryptable value fails loud. */
async function resolveUploadById(
  db: Db,
  userId: string,
  uploadId: string,
): Promise<{ fileName: string; text: string | null; pdf: Buffer | null; sizeBytes: number } | null> {
  const res = await db.query<{ file_name: string; storage: 's3' | 'local' | 'supabase'; storage_key: string; extracted_text: string | null; size_bytes: number }>(
    'SELECT file_name, storage, storage_key, extracted_text, size_bytes FROM uploads WHERE id = $1 AND user_id = $2',
    [uploadId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  let pdf: Buffer | null = null;
  if (fileExtension(row.file_name) === '.pdf') {
    try {
      pdf = await readFileBytes(row.storage, row.storage_key);
    } catch (err) {
      if (err instanceof Error && /decrypt|DATA_ENCRYPTION|integrity/i.test(err.message)) throw err;
      pdf = null;
    }
  }
  const text = row.extracted_text === null ? null : await decTextStrict(db, userId, row.extracted_text);
  return { fileName: row.file_name, text, pdf, sizeBytes: Number(row.size_bytes) };
}

/** Keep the job's counters and status in sync with its items. Recomputed from
 *  batch_items (not incremented) so it stays correct under a re-run/atomic-claim. */
async function syncJob(db: Db, jobId: string): Promise<void> {
  await db.query(
    `UPDATE batch_jobs SET
       done = (SELECT count(*) FROM batch_items WHERE batch_id = $1 AND status = 'done'),
       failed = (SELECT count(*) FROM batch_items WHERE batch_id = $1 AND status = 'error'),
       status = CASE WHEN (SELECT count(*) FROM batch_items WHERE batch_id = $1 AND status IN ('queued', 'processing')) = 0
                     THEN 'done' ELSE 'processing' END,
       updated_at = now()
     WHERE id = $1`,
    [jobId],
  );
}

/**
 * Process every queued item of a job, sequentially. Each item is claimed
 * atomically (queued → processing), so a stray double-invocation can't
 * double-analyse a file. Exported for deterministic tests (BATCH_AUTOSTART=0).
 */
export async function runBatch(db: Db, jobId: string): Promise<void> {
  const job = await db.query<{ user_id: string; jurisdiction: string | null }>(
    'SELECT user_id, jurisdiction FROM batch_jobs WHERE id = $1',
    [jobId],
  );
  const owner = job.rows[0];
  if (!owner) return;
  await db.query("UPDATE batch_jobs SET status = 'processing', updated_at = now() WHERE id = $1", [jobId]);

  const items = await db.query<{ id: string; upload_id: string | null; file_name: string }>(
    "SELECT id, upload_id, file_name FROM batch_items WHERE batch_id = $1 AND status = 'queued' ORDER BY ord",
    [jobId],
  );

  // Heartbeat КАЖДУЮ минуту, а не только между элементами: один долгий анализ
  // (LLM до 5+ минут) без него делал задание «осиротевшим» для recovery-свипа,
  // и живой элемент ложно помечался прерванным вторым инстансом.
  const keepalive = setInterval(() => {
    void db
      .query("UPDATE batch_jobs SET updated_at = now() WHERE id = $1 AND status = 'processing'", [jobId])
      .catch(() => undefined);
  }, 60_000);
  keepalive.unref?.();

  try {
  for (const item of items.rows) {
    // Atomic claim — skip if another runner already took this item.
    const claim = await db.query<{ id: string }>(
      "UPDATE batch_items SET status = 'processing' WHERE id = $1 AND status = 'queued' RETURNING id",
      [item.id],
    );
    if (!claim.rows[0]) continue;

    try {
      if (!item.upload_id) throw new HttpError(400, 'Файл не найден среди загрузок');
      const content = await resolveUploadById(db, owner.user_id, item.upload_id);
      if (!content) throw new HttpError(404, 'Загрузка не найдена или удалена');

      const source: AnalysisSource = {
        fileName: content.fileName,
        fileSizeLabel: formatSize(content.sizeBytes),
        sizeBytes: content.sizeBytes,
        text: content.text,
        pdf: content.pdf,
        jurisdiction: owner.jurisdiction,
        uploadId: item.upload_id,
      };
      // One AI unit per file (same quota as the interactive path); a rejected
      // reservation or a failed model releases it and surfaces here as an error.
      const result = await withAiRequest(db, owner.user_id, async (plan) => {
        const gen = await analyzeSource(db, owner.user_id, source, plan);
        return persistAnalysis(db, owner.user_id, source, gen, owner.user_id);
      });
      // Guard по статусу: если recovery-свип успел пометить элемент «прерван»,
      // поздний успех не должен молча перетирать это обратно в done.
      await db.query(
        `UPDATE batch_items SET status = 'done', document_id = $2, analysis_id = $3,
                risk_score = $4, risk_level = $5, findings_count = $6, error = NULL
         WHERE id = $1 AND status = 'processing'`,
        [item.id, result.documentId, result.id, result.riskScore, result.riskLevel, result.findings.length],
      );
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Не удалось разобрать файл';
      await db.query("UPDATE batch_items SET status = 'error', error = $2 WHERE id = $1 AND status = 'processing'", [
        item.id,
        message.slice(0, 300),
      ]);
    }
    await syncJob(db, jobId);
  }
  await syncJob(db, jobId);
  } finally {
    clearInterval(keepalive); // на всех путях — иначе интервал жил бы вечно
  }
}

/**
 * Recovery (при старте и раз в 10 минут, index.ts, под кластерным локом):
 * трогаем ТОЛЬКО осиротевшие задания — их heartbeat (batch_jobs.updated_at,
 * бампается keepalive-интервалом каждую минуту) молчит 3+ минуты (3 пропущенных удара = инстанс мёртв). При деплое с
 * перекрытием инстансов старый инстанс ещё работает и бампает updated_at —
 * его элементы не помечаются «прерванными» и не перезапускаются (двойной
 * расход ИИ). Осиротевший элемент честно получает ошибку «прервано», хвост
 * очереди дорабатывается, syncJob финализирует статус.
 */
/** Сколько осиротевших заданий поднимаем за один такт — чтобы перезапуск
 *  сервера не выстрелил десятком параллельных ИИ-прогонов разом. */
const MAX_RESUMED_BATCHES = 3;

export async function resumeBatchJobs(db: Db, opts: { awaitRuns?: boolean } = {}): Promise<void> {
  await db.query(
    `UPDATE batch_items SET status = 'error', error = 'Прервано перезапуском сервера'
     WHERE status = 'processing'
       AND batch_id IN (SELECT id FROM batch_jobs WHERE updated_at < now() - interval '3 minutes')`,
  );
  const jobs = await db.query<{ id: string }>(
    `SELECT id FROM batch_jobs
     WHERE status = 'queued'
        OR (status = 'processing' AND updated_at < now() - interval '3 minutes')`,
  );
  // ВАЖНО: не ждём завершения. runBatch прогоняет полные ИИ-анализы (часы на
  // большом батче), а свип живёт в общей последовательной очереди фоновых задач
  // под кластерным локом — раньше он держал очередь и лок всё это время, из-за
  // чего вставали биллинг, напоминания и стирание удалённых документов
  // (аудит 2026-08-03). Запускаем и сразу отдаём такт.
  const started = jobs.rows.slice(0, MAX_RESUMED_BATCHES).map((job) => runBatch(db, job.id).catch(() => undefined));
  // opts.awaitRuns — только для тестов, которым нужен детерминированный итог.
  if (opts.awaitRuns) await Promise.all(started);
  if (jobs.rows.length > MAX_RESUMED_BATCHES) {
    console.warn(`[batch] к восстановлению ${jobs.rows.length} заданий — за такт запущено ${MAX_RESUMED_BATCHES}, остальные подхватит следующий такт (через 5 минут).`);
  }
}

export function batchRoutes(app: FastifyInstance, db: Db): void {
  // Start a batch from already-uploaded files.
  app.post('/batch', { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<BatchJobWire> => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'batch');
    const body = asObject(req.body);
    const raw = body.uploadIds;
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('Поле "uploadIds" — непустой массив id загрузок');
    if (raw.length > MAX_BATCH_FILES) throw badRequest(`Слишком много файлов за раз (максимум ${MAX_BATCH_FILES})`);
    const uploadIds: string[] = [];
    for (const u of raw) {
      if (typeof u !== 'string' || !u.trim()) throw badRequest('Каждый uploadId — непустая строка');
      if (!uploadIds.includes(u)) uploadIds.push(u);
    }
    const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 60) : null;

    // Keep only uploads that exist AND belong to the caller — no cross-tenant ids.
    const owned = await db.query<{ id: string; file_name: string }>(
      'SELECT id, file_name FROM uploads WHERE id = ANY($1::text[]) AND user_id = $2',
      [uploadIds, req.currentUser.id],
    );
    const nameById = new Map(owned.rows.map((r) => [r.id, r.file_name]));
    const valid = uploadIds.filter((id) => nameById.has(id));
    if (!valid.length) throw badRequest('Не найдено ни одной вашей загрузки по переданным id');

    const jobId = newId('bat');
    await db.withTx(async (tx) => {
      await tx.query('INSERT INTO batch_jobs (id, user_id, jurisdiction, status, total) VALUES ($1, $2, $3, $4, $5)', [
        jobId,
        req.currentUser.id,
        jurisdiction,
        'queued',
        valid.length,
      ]);
      for (let i = 0; i < valid.length; i++) {
        await tx.query('INSERT INTO batch_items (id, batch_id, ord, file_name, upload_id, status) VALUES ($1, $2, $3, $4, $5, $6)', [
          newId('bi'),
          jobId,
          i,
          nameById.get(valid[i]),
          valid[i],
          'queued',
        ]);
      }
    });

    // Fire-and-forget background processing (disabled in tests, which drive
    // runBatch() explicitly). Analysis is idempotent-per-item via atomic claim.
    if (config.batchAutostart) void runBatch(db, jobId).catch((err) => req.log.error(err, 'batch processing failed'));

    reply.code(201);
    const created = await db.query<JobRow>('SELECT id, status, total, done, failed, created_at FROM batch_jobs WHERE id = $1', [jobId]);
    return jobToWire(created.rows[0]);
  });

  // Сводный отчёт по заданию: один HTML со всеми договорами, отсортированными
  // по риску, и топ-находками каждого — дельиверабл для дью-дилидженс.
  app.get('/batch/:id/report', { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'batch');
    const { id } = req.params as { id: string };
    const jobRes = await db.query<{ id: string; user_id: string; jurisdiction: string | null; created_at: Date | string }>(
      'SELECT id, user_id, jurisdiction, created_at FROM batch_jobs WHERE id = $1',
      [id],
    );
    const job = jobRes.rows[0];
    if (!job || job.user_id !== req.currentUser.id) throw notFound('Задание не найдено');

    const items = await db.query<{ file_name: string; status: string; analysis_id: string | null; risk_score: number | null; risk_level: string | null; findings_count: number | null; error: string | null }>(
      'SELECT file_name, status, analysis_id, risk_score, risk_level, findings_count, error FROM batch_items WHERE batch_id = $1 ORDER BY ord',
      [id],
    );
    const analysisIds = items.rows.map((i) => i.analysis_id).filter((x): x is string => Boolean(x));
    // Топ-3 находки на договор одним запросом (High прежде Medium прежде Low).
    const topByAnalysis = new Map<string, { severity: string; title: string; citation: string; verified: boolean }[]>();
    if (analysisIds.length) {
      const f = await db.query<{ analysis_id: string; severity: string; title: string; citation: string; unit_id: string | null; unverified: boolean }>(
        `SELECT analysis_id, severity, title, citation, unit_id, unverified
         FROM findings WHERE analysis_id = ANY($1::text[])
         ORDER BY analysis_id, CASE severity WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, ord`,
        [analysisIds],
      );
      for (const row of f.rows) {
        const list = topByAnalysis.get(row.analysis_id) ?? [];
        if (list.length < 3) {
          list.push({ severity: row.severity, title: row.title, citation: row.citation, verified: Boolean(row.unit_id) && !row.unverified });
          topByAnalysis.set(row.analysis_id, list);
        }
      }
    }

    const html = renderBatchReportHtml({
      jobId: job.id,
      createdAt: new Date(job.created_at as string).toISOString(),
      jurisdiction: job.jurisdiction,
      ownerName: req.currentUser.name,
      ownerFirm: req.currentUser.firm,
      items: items.rows.map((i) => ({
        fileName: i.file_name,
        status: i.status,
        riskScore: i.risk_score,
        riskLevel: i.risk_level,
        findingsCount: i.findings_count,
        error: i.error,
        topFindings: i.analysis_id ? (topByAnalysis.get(i.analysis_id) ?? []) : [],
      })),
    });
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="lexab-batch-report-${id}.html"`);
    await audit(db, req, { type: 'document.exported', teamOwnerId: req.currentUser.id, target: { type: 'batch', id } });
    return html;
  });

  // Job list (no items) — the /batch history table.
  app.get('/batch', { preHandler: [app.authenticate] }, async (req): Promise<BatchJobWire[]> => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'batch');
    const res = await db.query<JobRow>(
      'SELECT id, status, total, done, failed, created_at FROM batch_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.currentUser.id],
    );
    return res.rows.map(jobToWire);
  });

  // One job with its items — polled by the frontend for progress.
  app.get('/batch/:id', { preHandler: [app.authenticate] }, async (req): Promise<BatchJobWire> => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'batch');
    const { id } = req.params as { id: string };
    const jobRes = await db.query<JobRow & { user_id: string }>(
      'SELECT id, user_id, status, total, done, failed, created_at FROM batch_jobs WHERE id = $1',
      [id],
    );
    const job = jobRes.rows[0];
    if (!job || job.user_id !== req.currentUser.id) throw notFound('Задание не найдено');
    const itemsRes = await db.query<ItemRow>(
      `SELECT id, file_name, status, document_id, analysis_id, risk_score, risk_level, findings_count, error
       FROM batch_items WHERE batch_id = $1 ORDER BY ord`,
      [id],
    );
    return { ...jobToWire(job), items: itemsRes.rows.map(itemToWire) };
  });
}
