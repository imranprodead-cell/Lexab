/**
 * Approval workflows (маршруты согласования) — Pro/Business feature.
 *
 *   POST /approvals { documentId, steps }  — start a chain (owner only)
 *   GET  /approvals?documentId=…           — flows of a document (team-readable)
 *   POST /approvals/:id/cancel             — owner cancels an active flow
 *   GET  /approve/:token                   — PUBLIC: step + document + chain
 *   POST /approve/:token { decision, comment? } — PUBLIC: approve/reject
 *
 * Reminders: checkApprovalDeadlines() runs on an interval — overdue pending
 * steps get one reminder email; the owner gets an in-app notification.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { decJsonFromJsonb, decText } from '../lib/docCrypto.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { resolveDocumentAccess } from '../lib/teamAccess.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { getUserByEmail } from '../plugins/auth.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «1 шаг», «2 шага», «5 шагов» — clean Russian plural for the bell. */
function stepsRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} шаг`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} шага`;
  return `${n} шагов`;
}

interface StepRow {
  id: string;
  ord: number;
  approver_name: string;
  approver_email: string;
  role_label: string | null;
  status: 'waiting' | 'pending' | 'approved' | 'rejected';
  due_at: Date | string | null;
  token: string | null;
  decided_at: Date | string | null;
  comment: string | null;
}

function toStep(r: StepRow, includeToken: boolean) {
  return {
    id: r.id,
    ord: r.ord,
    name: r.approver_name,
    email: r.approver_email,
    role: r.role_label,
    status: r.status,
    dueAt: r.due_at ? toIso(r.due_at) : null,
    decidedAt: r.decided_at ? toIso(r.decided_at) : null,
    comment: r.comment,
    ...(includeToken && r.token && (r.status === 'pending' || r.status === 'waiting') ? { token: r.token } : {}),
  };
}

async function flowSteps(db: Db, flowId: string): Promise<StepRow[]> {
  const res = await db.query<StepRow>(
    `SELECT id, ord, approver_name, approver_email, role_label, status, due_at, token, decided_at, comment
     FROM approval_steps WHERE flow_id = $1 ORDER BY ord`,
    [flowId],
  );
  return res.rows;
}

/** In-app ping for approvers who have a Lexab account (mirrors the email). */
async function notifyApprover(db: Db, ownerName: string, documentName: string, step: StepRow): Promise<void> {
  const user = await getUserByEmail(db, step.approver_email.toLowerCase());
  if (!user) return;
  await notify(db, user.id, 'docs', 'Требуется ваше согласование', 'Your approval is requested', {
    bodyRu: `${documentName} · от ${ownerName}`,
    bodyEn: `${documentName} · from ${ownerName}`,
    action: { kind: 'open', data: `/approve/${step.token}` },
  });
}

/** Email the approver whose step just became pending. */
async function mailApprover(ownerName: string, ownerFirm: string, documentName: string, step: StepRow): Promise<void> {
  const url = `${config.appBaseUrl}/approve/${step.token}`;
  const dueDate = step.due_at ? new Date(step.due_at as string).toLocaleDateString('ru-RU') : null;
  const due = dueDate ? `<p>Срок решения: <strong>${dueDate}</strong>.</p>` : '';
  const dueEn = dueDate ? `<p>Decision due by: <strong>${dueDate}</strong>.</p>` : '';
  void sendMail({
    to: step.approver_email,
    subject: biSubject('Требуется ваше согласование', 'Your approval is requested', documentName),
    html: mailLayout(
      biLine('Документ ждёт вашего решения', 'A document is awaiting your decision'),
      biBody(
        `<p>Здравствуйте, <strong>${escapeMailHtml(step.approver_name)}</strong>!</p>
       <p><strong>${escapeMailHtml(ownerName)}</strong> (${escapeMailHtml(ownerFirm)}) отправляет вам документ
       <strong>${escapeMailHtml(documentName)}</strong> на согласование. Ваш шаг: <strong>${escapeMailHtml(step.role_label ?? 'согласующий')}</strong>.</p>
       ${due}
       <p>Откройте ссылку, просмотрите документ и примите решение — регистрация не нужна.</p>`,
        `<p>Hello <strong>${escapeMailHtml(step.approver_name)}</strong>,</p>
       <p><strong>${escapeMailHtml(ownerName)}</strong> (${escapeMailHtml(ownerFirm)}) is sending you the document
       <strong>${escapeMailHtml(documentName)}</strong> for approval. Your step: <strong>${escapeMailHtml(step.role_label ?? 'approver')}</strong>.</p>
       ${dueEn}
       <p>Open the link, review the document and make your decision — no account needed.</p>`,
      ),
      biLine('Открыть и решить', 'Open & decide'),
      url,
    ),
  });
}

/** A single approver in a chain (already validated). */
export interface ApprovalStepInput {
  name: string;
  email: string;
  role: string | null;
  dueAt: Date | null;
}

/** Parse+validate the raw `steps` payload into ApprovalStepInput[] (1–10). */
export function parseApprovalSteps(rawSteps: unknown): ApprovalStepInput[] {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > 10) {
    throw badRequest('Field "steps" must be an array of 1–10 approvers');
  }
  return rawSteps.map((s, i) => {
    const obj = asObject(s, `steps[${i}]`);
    const name = requireString(obj, 'name', { min: 1, max: 200 });
    const email = requireString(obj, 'email', { min: 3, max: 320 }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw badRequest(`steps[${i}].email is not a valid email`);
    const role = typeof obj.role === 'string' ? obj.role.slice(0, 100) : null;
    let dueAt: Date | null = null;
    if (typeof obj.dueAt === 'string' && obj.dueAt) {
      const d = new Date(obj.dueAt);
      if (Number.isNaN(d.getTime())) throw badRequest(`steps[${i}].dueAt is not a valid date`);
      dueAt = d;
    }
    return { name, email, role, dueAt };
  });
}

/**
 * Create an active approval chain for a document and notify the first approver.
 * Caller is responsible for access + duplicate-flow checks. Reused by the
 * approvals route and the agentic-workflow orchestrator (Этап 4).
 */
export async function startApprovalFlow(
  db: Db,
  owner: { id: string; name: string; firm: string },
  document: { id: string; name: string },
  steps: ApprovalStepInput[],
): Promise<{ id: string; documentId: string; status: string; createdAt: string; steps: ReturnType<typeof toStep>[] }> {
  const flowId = newId('af');
  await db.query(
    `INSERT INTO approval_flows (id, document_id, owner_user_id, status) VALUES ($1, $2, $3, 'active')`,
    [flowId, document.id, owner.id],
  );
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await db.query(
      `INSERT INTO approval_steps (id, flow_id, ord, approver_name, approver_email, role_label, status, due_at, token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId('as'), flowId, i, s.name, s.email, s.role, i === 0 ? 'pending' : 'waiting', s.dueAt, crypto.randomBytes(24).toString('base64url')],
    );
  }

  const created = await flowSteps(db, flowId);
  await mailApprover(owner.name, owner.firm, document.name, created[0]);
  await notifyApprover(db, owner.name, document.name, created[0]);
  await notify(db, owner.id, 'docs', 'Согласование запущено', 'Approval workflow started', {
    bodyRu: `${document.name} · ${stepsRu(steps.length)}`,
    bodyEn: `${document.name} · ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`,
    action: { kind: 'open', data: `/documents/${document.id}` },
  });
  return {
    id: flowId,
    documentId: document.id,
    status: 'active',
    createdAt: new Date().toISOString(),
    steps: created.map((s) => toStep(s, true)),
  };
}

export function approvalRoutes(app: FastifyInstance, db: Db): void {
  // Start a chain. Pro/Business only.
  app.post('/approvals', { preHandler: [app.authenticateReal] }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'approvals');

    const body = asObject(req.body);
    const documentId = requireString(body, 'documentId', { min: 1, max: 60 });
    const steps = parseApprovalSteps(body.steps);

    const access = await resolveDocumentAccess(db, req.currentUser.id, documentId);
    if (access.access !== 'owner') throw new HttpError(403, 'Маршрут может запустить только владелец документа');

    const active = await db.query(
      `SELECT 1 FROM approval_flows WHERE document_id = $1 AND status = 'active'`,
      [documentId],
    );
    if (active.rows[0]) throw new HttpError(409, 'По этому документу уже идёт согласование — отмените его сначала');

    const flow = await startApprovalFlow(
      db,
      { id: req.currentUser.id, name: req.currentUser.name, firm: req.currentUser.firm },
      { id: documentId, name: access.doc.name },
      steps,
    );

    await audit(db, req, {
      type: 'approval.started',
      target: { type: 'document', id: documentId, label: access.doc.name },
      metadata: { steps: steps.length },
    });
    reply.code(201);
    return flow;
  });

  // Flows for a document (owner sees links; team members see progress).
  app.get('/approvals', { preHandler: [app.authenticate] }, async (req) => {
    const { documentId } = req.query as { documentId?: string };
    if (!documentId) throw badRequest('Query param "documentId" is required');
    const access = await resolveDocumentAccess(db, req.currentUser.id, documentId);

    const flows = await db.query<{ id: string; status: string; created_at: Date | string }>(
      `SELECT id, status, created_at FROM approval_flows
       WHERE document_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [documentId],
    );
    // Steps of all flows in ONE query (was an N+1: one query per flow).
    const flowIds = flows.rows.map((f) => f.id);
    const allSteps = flowIds.length
      ? await db.query<StepRow & { flow_id: string }>(
          `SELECT flow_id, id, ord, approver_name, approver_email, role_label, status, due_at, token, decided_at, comment
           FROM approval_steps WHERE flow_id = ANY($1::text[]) ORDER BY flow_id, ord`,
          [flowIds],
        )
      : { rows: [] };
    const byFlow = new Map<string, StepRow[]>();
    for (const s of allSteps.rows) {
      const list = byFlow.get(s.flow_id) ?? [];
      list.push(s);
      byFlow.set(s.flow_id, list);
    }
    return flows.rows.map((f) => ({
      id: f.id,
      documentId,
      status: f.status,
      createdAt: toIso(f.created_at),
      steps: (byFlow.get(f.id) ?? []).map((s) => toStep(s, access.access === 'owner')),
    }));
  });

  app.post('/approvals/:id/cancel', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ id: string; document_id: string }>(
      `UPDATE approval_flows SET status = 'cancelled'
       WHERE id = $1 AND owner_user_id = $2 AND status = 'active' RETURNING id, document_id`,
      [id, req.currentUser.id],
    );
    if (!res.rows[0]) throw notFound('Активный маршрут не найден');
    // Отмена — такое же событие маршрута, как старт/решение: пишем в аудит.
    // Актор — владелец (WHERE owner_user_id = currentUser), поэтому teamOwnerId
    // по умолчанию = actorId = владелец, как у approval.started. Только id, без
    // содержимого документа.
    await audit(db, req, {
      type: 'approval.cancelled',
      target: { type: 'document', id: res.rows[0].document_id },
      metadata: { approvalId: id },
    });
    reply.code(204);
  });

  /* ── PUBLIC decision endpoints ─────────────────────────────────────────── */

  interface TokenRow extends StepRow {
    flow_id: string;
    flow_status: string;
    document_id: string;
    document_name: string;
    owner_id: string;
    owner_name: string;
    owner_firm: string;
    owner_email: string;
  }

  async function findStepByToken(token: string): Promise<TokenRow | null> {
    const res = await db.query<TokenRow>(
      `SELECT s.id, s.ord, s.approver_name, s.approver_email, s.role_label, s.status, s.due_at, s.token,
              s.decided_at, s.comment, s.flow_id,
              f.status AS flow_status, f.document_id,
              d.name AS document_name,
              u.id AS owner_id, u.name AS owner_name, u.firm AS owner_firm, u.email AS owner_email
       FROM approval_steps s
       JOIN approval_flows f ON f.id = s.flow_id
       JOIN documents d ON d.id = f.document_id AND d.deleted_at IS NULL
       JOIN users u ON u.id = f.owner_user_id
       WHERE s.token = $1`,
      [token],
    );
    return res.rows[0] ?? null;
  }

  /** Latest analysed text of the document (redlines applied), for review. */
  async function documentText(ownerId: string, fileName: string): Promise<string | null> {
    const a = await db.query<{ id: string; document_blocks: unknown }>(
      `SELECT id, document_blocks FROM analyses
       WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1`,
      [ownerId, fileName],
    );
    const row = a.rows[0];
    if (!row) return null;
    // Encrypted at rest — decrypt with the document owner's data key.
    const blocks = (await decJsonFromJsonb(db, ownerId, row.document_blocks)) as
      | { type: string; text?: string; segments?: (string | { redlineId: string })[] }[]
      | null;
    if (blocks === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
    const redlines = await db.query<{ id: string; del_text: string; ins_text: string; status: string }>(
      'SELECT id, del_text, ins_text, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
      [row.id],
    );
    const byId = new Map<string, { del_text: string; ins_text: string; status: string }>();
    for (const r of redlines.rows) {
      const delText = await decText(db, ownerId, r.del_text);
      const insText = await decText(db, ownerId, r.ins_text);
      if (delText === null || insText === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
      byId.set(r.id, { del_text: delText, ins_text: insText, status: r.status });
    }
    return blocks
      .map((b) => {
        if (b.type === 'heading') return `## ${b.text ?? ''}`;
        return (b.segments ?? [])
          .map((seg) => {
            if (typeof seg === 'string') return seg;
            const rl = byId.get(seg.redlineId);
            return rl ? (rl.status === 'rejected' ? rl.del_text : rl.ins_text) : '';
          })
          .join('');
      })
      .join('\n\n');
  }

  app.get('/approve/:token', async (req) => {
    const { token } = req.params as { token: string };
    const row = await findStepByToken(token);
    if (!row) throw notFound('Ссылка недействительна или маршрут отменён');
    // Stop serving the document once the workflow is no longer active — a
    // cancelled/completed/rejected flow must not keep exposing the contract to
    // whoever holds (or forwarded) the link. Mirrors the POST guard below.
    if (row.flow_status !== 'active') throw notFound('Ссылка недействительна или маршрут завершён');

    const steps = await flowSteps(db, row.flow_id);
    return {
      documentName: row.document_name,
      ownerName: row.owner_name,
      ownerFirm: row.owner_firm,
      flowStatus: row.flow_status,
      me: toStep(row, false),
      chain: steps.map((s) => toStep(s, false)),
      documentText: await documentText(row.owner_id, row.document_name),
    };
  });

  app.post('/approve/:token', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const body = asObject(req.body);
    const decision = requireString(body, 'decision', { min: 1, max: 20 });
    if (decision !== 'approved' && decision !== 'rejected') {
      throw badRequest('Field "decision" must be "approved" or "rejected"');
    }
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : null;

    const row = await findStepByToken(token);
    if (!row) throw notFound('Ссылка недействительна или маршрут отменён');
    if (row.flow_status !== 'active') throw badRequest('Маршрут уже завершён или отменён');
    if (row.status !== 'pending') {
      throw badRequest(row.status === 'waiting' ? 'Сейчас очередь предыдущего согласующего' : 'Решение по этому шагу уже принято');
    }

    // Atomic single-shot: the `AND status = 'pending'` guard collapses two
    // concurrent decisions (e.g. approve + reject racing) into one — only the
    // winner runs the branch below, so the chain can't double-advance.
    const decided = await db.query(
      `UPDATE approval_steps SET status = $2, decided_at = now(), comment = $3 WHERE id = $1 AND status = 'pending' RETURNING id`,
      [row.id, decision, comment],
    );
    if (decided.rows.length === 0) throw badRequest('Решение по этому шагу уже принято');

    // Публичный маршрут: актор — согласующий по токену (не сессия); req даёт IP.
    await audit(db, req, {
      type: 'approval.decided',
      teamOwnerId: row.owner_id,
      actorId: null,
      actorLabel: `${row.approver_name} <${row.approver_email}>`,
      target: { type: 'document', id: row.document_id ?? undefined, label: row.document_name },
      metadata: { decision },
    });

    if (decision === 'rejected') {
      await db.query(`UPDATE approval_flows SET status = 'rejected' WHERE id = $1`, [row.flow_id]);
      await notify(db, row.owner_id, 'alert', 'Согласование отклонено', 'Approval rejected', {
        bodyRu: `${row.document_name} · ${row.approver_name}${comment ? ` · комментарий: ${comment}` : ''}`,
        bodyEn: `${row.document_name} · ${row.approver_name}${comment ? ` · comment: ${comment}` : ''}`,
        action: { kind: 'open', data: `/documents/${row.document_id}` },
      });
      void sendMail({
        to: row.owner_email,
        subject: biSubject('Согласование отклонено', 'Approval rejected', row.document_name),
        html: mailLayout(
          biLine('Согласование отклонено', 'Approval rejected'),
          biBody(
            `<p>Документ <strong>${escapeMailHtml(row.document_name)}</strong> отклонён. Решение: <strong>${escapeMailHtml(row.approver_name)}</strong> (${escapeMailHtml(row.role_label ?? 'согласующий')}).</p>
           ${comment ? `<p>Комментарий: «${escapeMailHtml(comment)}»</p>` : ''}`,
            `<p>The document <strong>${escapeMailHtml(row.document_name)}</strong> was rejected. Decided by: <strong>${escapeMailHtml(row.approver_name)}</strong> (${escapeMailHtml(row.role_label ?? 'approver')}).</p>
           ${comment ? `<p>Comment: “${escapeMailHtml(comment)}”</p>` : ''}`,
          ),
          biLine('Открыть документ', 'Open the document'),
          `${config.appBaseUrl}/documents/${row.document_id}`,
        ),
      });
      return { ok: true, flowStatus: 'rejected' };
    }

    // Approved → hand over to the next step, or finish the flow.
    const steps = await flowSteps(db, row.flow_id);
    const next = steps.find((s) => s.status === 'waiting');
    if (next) {
      await db.query(`UPDATE approval_steps SET status = 'pending' WHERE id = $1`, [next.id]);
      await mailApprover(row.owner_name, row.owner_firm, row.document_name, next);
      await notifyApprover(db, row.owner_name, row.document_name, next);
      await notify(db, row.owner_id, 'check', 'Шаг согласован', 'Approval step completed', {
        bodyRu: `${row.document_name} · ${row.approver_name} · очередь за: ${next.approver_name}`,
        bodyEn: `${row.document_name} · ${row.approver_name} · next: ${next.approver_name}`,
        action: { kind: 'open', data: `/documents/${row.document_id}` },
      });
      return { ok: true, flowStatus: 'active', next: next.approver_name };
    }

    await db.query(`UPDATE approval_flows SET status = 'approved' WHERE id = $1`, [row.flow_id]);
    await db.query(`UPDATE documents SET status = 'Reviewed', updated_at = now() WHERE id = $1`, [row.document_id]);
    await notify(db, row.owner_id, 'check', 'Согласование завершено', 'Approval workflow completed', {
      bodyRu: `${row.document_name} · все шаги пройдены`,
      bodyEn: `${row.document_name} · all steps approved`,
      action: { kind: 'open', data: `/documents/${row.document_id}` },
    });
    void sendMail({
      to: row.owner_email,
      subject: biSubject('Согласование завершено', 'Approval completed', row.document_name),
      html: mailLayout(
        biLine('Все шаги согласованы', 'All steps approved'),
        biBody(
          `<p>Документ <strong>${escapeMailHtml(row.document_name)}</strong> прошёл весь маршрут согласования — последний шаг: <strong>${escapeMailHtml(row.approver_name)}</strong>.</p>`,
          `<p>The document <strong>${escapeMailHtml(row.document_name)}</strong> has passed the entire approval workflow — last step: <strong>${escapeMailHtml(row.approver_name)}</strong>.</p>`,
        ),
        biLine('Открыть документ', 'Open the document'),
        `${config.appBaseUrl}/documents/${row.document_id}`,
      ),
    });
    return { ok: true, flowStatus: 'approved' };
  });
}

/** Overdue pending steps: one reminder to the approver + a note to the owner. */
export async function checkApprovalDeadlines(db: Db): Promise<void> {
  const res = await db.query<{
    id: string;
    approver_name: string;
    approver_email: string;
    role_label: string | null;
    token: string | null;
    due_at: Date | string;
    document_id: string;
    document_name: string;
    owner_id: string;
    owner_name: string;
    owner_firm: string;
  }>(
    `SELECT s.id, s.approver_name, s.approver_email, s.role_label, s.token, s.due_at,
            d.id AS document_id, d.name AS document_name, u.id AS owner_id, u.name AS owner_name, u.firm AS owner_firm
     FROM approval_steps s
     JOIN approval_flows f ON f.id = s.flow_id AND f.status = 'active'
     JOIN documents d ON d.id = f.document_id
     JOIN users u ON u.id = f.owner_user_id
     WHERE s.status = 'pending' AND s.reminded = false AND s.due_at IS NOT NULL AND s.due_at < now()`,
  );
  for (const s of res.rows) {
    await db.query('UPDATE approval_steps SET reminded = true WHERE id = $1', [s.id]);
    void sendMail({
      to: s.approver_email,
      subject: biSubject('Напоминание: согласование просрочено', 'Reminder: approval overdue', s.document_name),
      html: mailLayout(
        biLine('Срок согласования истёк', 'The approval deadline has passed'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(s.approver_name)}</strong>!</p>
         <p>Документ <strong>${escapeMailHtml(s.document_name)}</strong> от ${escapeMailHtml(s.owner_name)} (${escapeMailHtml(s.owner_firm)}) всё ещё ждёт вашего решения — срок истёк ${new Date(s.due_at as string).toLocaleDateString('ru-RU')}.</p>`,
          `<p>Hello <strong>${escapeMailHtml(s.approver_name)}</strong>,</p>
         <p>The document <strong>${escapeMailHtml(s.document_name)}</strong> from ${escapeMailHtml(s.owner_name)} (${escapeMailHtml(s.owner_firm)}) is still awaiting your decision — the deadline passed on ${new Date(s.due_at as string).toLocaleDateString('ru-RU')}.</p>`,
        ),
        biLine('Открыть и решить', 'Open & decide'),
        `${config.appBaseUrl}/approve/${s.token}`,
      ),
    });
    // Registered approver: the reminder also lands in their bell.
    const approverUser = await getUserByEmail(db, s.approver_email.toLowerCase());
    if (approverUser) {
      await notify(db, approverUser.id, 'alert', 'Напоминание о согласовании', 'Approval reminder', {
        bodyRu: `${s.document_name} · срок истёк ${new Date(s.due_at as string).toLocaleDateString('ru-RU')}`,
        bodyEn: `${s.document_name} · due ${new Date(s.due_at as string).toLocaleDateString('en-GB')}`,
        action: { kind: 'open', data: `/approve/${s.token}` },
      });
    }
    await notify(db, s.owner_id, 'alert', 'Дедлайн согласования просрочен', 'Approval deadline missed', {
      bodyRu: `${s.document_name} · ${s.approver_name} · напоминание отправлено`,
      bodyEn: `${s.document_name} · ${s.approver_name} · reminder sent`,
      action: { kind: 'open', data: `/documents/${s.document_id}` },
    });
  }
}
