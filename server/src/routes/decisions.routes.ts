/**
 * Решения по находкам разбора и отметки по продлению договора (ui-test,
 * 2026-11-15). Чтение — всем, кто видит разбор/документ (владелец и команда
 * по расшаренному документу); запись — только с правом редактирования.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { decText, encText } from '../lib/docCrypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { assertFeature } from '../lib/limits.ts';
import { assertCanEdit, resolveAnalysisAccess, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { asObject, optionalString, requireOneOf, requireString } from '../lib/validate.ts';

export interface DecisionWire {
  kind: 'fixed' | 'ok' | 'assigned';
  /** Кто решил (или передал коллеге) — имя из профиля. */
  who: string;
  at: string;
  to?: string;
  note?: string;
}

export interface RenewalMarkWire {
  kind: 'sent' | 'keep';
  who: string;
  at: string;
  last: string;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

async function userName(db: Db, userId: string): Promise<string> {
  const res = await db.query<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = $1', [userId]);
  const row = res.rows[0];
  return row?.name?.trim() || row?.email || '—';
}

/** Отметки продления для набора документов (для списка «Контракты»). */
export async function loadRenewalMarks(db: Db, documentIds: string[]): Promise<Map<string, RenewalMarkWire>> {
  const out = new Map<string, RenewalMarkWire>();
  if (!documentIds.length) return out;
  const res = await db.query<{ document_id: string; kind: 'sent' | 'keep'; last_day: string; marked_at: Date | string; name: string; email: string }>(
    `SELECT m.document_id, m.kind, to_char(m.last_day, 'YYYY-MM-DD') AS last_day, m.marked_at, u.name, u.email
     FROM renewal_marks m JOIN users u ON u.id = m.marked_by
     WHERE m.document_id = ANY($1::text[])`,
    [documentIds],
  );
  for (const r of res.rows) {
    out.set(r.document_id, { kind: r.kind, last: r.last_day, at: iso(r.marked_at), who: r.name?.trim() || r.email || '—' });
  }
  return out;
}

export function decisionRoutes(app: FastifyInstance, db: Db): void {
  app.get('/analysis/:id/decisions', { preHandler: [app.authenticate] }, async (req): Promise<Record<string, DecisionWire>> => {
    const { id } = req.params as { id: string };
    const access = await resolveAnalysisAccess(db, req.currentUser.id, id);
    const res = await db.query<{ finding_id: string; kind: DecisionWire['kind']; assigned_to: string | null; note_enc: string | null; decided_at: Date | string; name: string; email: string }>(
      `SELECT d.finding_id, d.kind, d.assigned_to, d.note_enc, d.decided_at, u.name, u.email
       FROM finding_decisions d JOIN users u ON u.id = d.decided_by
       WHERE d.analysis_id = $1`,
      [id],
    );
    const out: Record<string, DecisionWire> = {};
    for (const r of res.rows) {
      const note = r.note_enc ? await decText(db, access.analysisUserId, r.note_enc) : null;
      out[r.finding_id] = {
        kind: r.kind,
        who: r.name?.trim() || r.email || '—',
        at: iso(r.decided_at),
        ...(r.assigned_to ? { to: r.assigned_to } : {}),
        ...(note ? { note } : {}),
      };
    }
    return out;
  });

  app.put('/analysis/:id/decisions/:fid', { preHandler: [app.authenticate] }, async (req): Promise<DecisionWire> => {
    const { id, fid } = req.params as { id: string; fid: string };
    const access = await resolveAnalysisAccess(db, req.currentUser.id, id, true);
    const body = asObject(req.body);
    const kind = requireOneOf(body, 'kind', ['fixed', 'ok', 'assigned'] as const);
    const to = kind === 'assigned' ? requireString(body, 'to', { max: 200 }) : undefined;
    const note = optionalString(body, 'note', { max: 1000 })?.trim() || undefined;

    const exists = await db.query('SELECT 1 FROM findings WHERE analysis_id = $1 AND id = $2', [id, fid]);
    if (!exists.rows.length) throw notFound('Finding not found');

    const noteEnc = note ? await encText(db, access.analysisUserId, note) : null;
    const res = await db.query<{ decided_at: Date | string }>(
      `INSERT INTO finding_decisions (analysis_id, finding_id, kind, decided_by, assigned_to, note_enc, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (analysis_id, finding_id) DO UPDATE
         SET kind = EXCLUDED.kind, decided_by = EXCLUDED.decided_by, assigned_to = EXCLUDED.assigned_to,
             note_enc = EXCLUDED.note_enc, decided_at = EXCLUDED.decided_at
       RETURNING decided_at`,
      [id, fid, kind, req.currentUser.id, to ?? null, noteEnc],
    );
    return { kind, who: await userName(db, req.currentUser.id), at: iso(res.rows[0].decided_at), ...(to ? { to } : {}), ...(note ? { note } : {}) };
  });

  app.delete('/analysis/:id/decisions/:fid', { preHandler: [app.authenticate] }, async (req) => {
    const { id, fid } = req.params as { id: string; fid: string };
    await resolveAnalysisAccess(db, req.currentUser.id, id, true);
    await db.query('DELETE FROM finding_decisions WHERE analysis_id = $1 AND finding_id = $2', [id, fid]);
    return { ok: true };
  });

  app.put('/contracts/:documentId/renewal-mark', { preHandler: [app.authenticate] }, async (req): Promise<RenewalMarkWire> => {
    const { documentId } = req.params as { documentId: string };
    await assertFeature(db, req.currentUser.id, 'clm');
    const access = await resolveDocumentAccess(db, req.currentUser.id, documentId);
    assertCanEdit(access.access);
    const body = asObject(req.body);
    const kind = requireOneOf(body, 'kind', ['sent', 'keep'] as const);
    const last = requireString(body, 'last', { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(last) || Number.isNaN(Date.parse(`${last}T00:00:00Z`))) throw badRequest('Field "last" must be a date YYYY-MM-DD');
    const res = await db.query<{ marked_at: Date | string }>(
      `INSERT INTO renewal_marks (document_id, last_day, kind, marked_by, marked_at)
       VALUES ($1, $2::date, $3, $4, now())
       ON CONFLICT (document_id) DO UPDATE
         SET last_day = EXCLUDED.last_day, kind = EXCLUDED.kind, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at
       RETURNING marked_at`,
      [documentId, last, kind, req.currentUser.id],
    );
    return { kind, last, who: await userName(db, req.currentUser.id), at: iso(res.rows[0].marked_at) };
  });

  app.delete('/contracts/:documentId/renewal-mark', { preHandler: [app.authenticate] }, async (req) => {
    const { documentId } = req.params as { documentId: string };
    await assertFeature(db, req.currentUser.id, 'clm');
    const access = await resolveDocumentAccess(db, req.currentUser.id, documentId);
    assertCanEdit(access.access);
    await db.query('DELETE FROM renewal_marks WHERE document_id = $1', [documentId]);
    return { ok: true };
  });
}
