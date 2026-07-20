/**
 * Client playbooks — a team's standard contract positions ("no liability cap
 * above X", "arbitration only in Tashkent"). The analysis pipeline loads the
 * active playbook for the reviewer's team and flags deviating clauses as
 * findings (see loadActivePlaybook in analysis.routes.ts).
 *
 * Team-scoped: a playbook belongs to the team OWNER (a "team" is the owner user
 * + their team_members). The owner and active admins/editors may edit; every
 * active member may read. Rule text is encrypted at rest with the owner's key.
 */
import type { FastifyInstance } from 'fastify';
import type { Db, Queryable } from '../db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { decText, encText } from '../lib/docCrypto.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature } from '../lib/limits.ts';
import { teamRoleFor } from '../lib/teamAccess.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';

/** Jurisdiction codes a playbook may target (matches jurisdictionCode()); null = all. */
const CORPORA = new Set(['UK', 'UZ', 'KZ', 'DE', 'US', 'CA', 'AE']);

interface Playbook {
  id: string;
  name: string;
  jurisdiction: string | null;
  active: boolean;
  rules: string[];
  createdAt: string;
  updatedAt: string;
}

/** The account whose playbooks apply to `userId`: their team owner when an
 *  active member, otherwise themselves. */
async function playbookOwner(db: Db, userId: string): Promise<string> {
  const res = await db.query<{ owner_user_id: string }>(
    "SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND status = 'active' AND owner_user_id <> $1 LIMIT 1",
    [userId],
  );
  return res.rows[0]?.owner_user_id ?? userId;
}

async function assertCanWrite(db: Db, userId: string, ownerId: string): Promise<void> {
  if (userId === ownerId) return; // the team owner
  const role = await teamRoleFor(db, userId, ownerId);
  if (role === 'admin' || role === 'editor') return;
  throw badRequest('Только владелец команды, админ или редактор может менять плейбуки');
}

function parseRules(body: Record<string, unknown>): string[] {
  const raw = body.rules;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw badRequest('Поле "rules" должно быть массивом строк');
  if (raw.length > 100) throw badRequest('Слишком много правил (максимум 100)');
  const rules: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string') throw badRequest('Каждое правило — строка');
    const t = r.trim();
    if (t) rules.push(t.slice(0, 2000));
  }
  return rules;
}

function parseJurisdiction(body: Record<string, unknown>): string | null {
  const j = optionalString(body, 'jurisdiction');
  if (!j) return null;
  if (!CORPORA.has(j)) throw badRequest(`Неизвестная юрисдикция «${j}»`);
  return j;
}

/** Load one playbook with its decrypted rules (keyed by the owner). */
async function loadOne(db: Db, ownerId: string, id: string): Promise<Playbook | null> {
  const res = await db.query<{ id: string; name: string; jurisdiction: string | null; active: boolean; created_at: Date | string; updated_at: Date | string }>(
    'SELECT id, name, jurisdiction, active, created_at, updated_at FROM playbooks WHERE id = $1 AND owner_user_id = $2',
    [id, ownerId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const rulesRes = await db.query<{ text_enc: string }>('SELECT text_enc FROM playbook_rules WHERE playbook_id = $1 ORDER BY ord', [id]);
  const rules: string[] = [];
  for (const r of rulesRes.rows) {
    const text = await decText(db, ownerId, r.text_enc);
    if (text !== null) rules.push(text);
  }
  return { id: row.id, name: row.name, jurisdiction: row.jurisdiction, active: row.active, rules, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) };
}

/** Replace all rules of a playbook. `encRules` must ALREADY be ciphertext — do
 *  the encText() calls BEFORE opening the transaction: encText hits the DB to
 *  resolve the owner's data key, and on the single-connection PGlite adapter a
 *  nested query inside an open withTx() would deadlock. */
async function writeRules(tx: Queryable, playbookId: string, encRules: string[]): Promise<void> {
  await tx.query('DELETE FROM playbook_rules WHERE playbook_id = $1', [playbookId]);
  for (let i = 0; i < encRules.length; i++) {
    await tx.query('INSERT INTO playbook_rules (id, playbook_id, ord, text_enc) VALUES ($1, $2, $3, $4)', [
      newId('pr'),
      playbookId,
      i,
      encRules[i],
    ]);
  }
}

export function playbookRoutes(app: FastifyInstance, db: Db): void {
  app.get('/playbooks', { preHandler: [app.authenticate] }, async (req): Promise<Playbook[]> => {
    await assertFeature(db, req.currentUser.id, 'playbooks');
    const ownerId = await playbookOwner(db, req.currentUser.id);
    const res = await db.query<{ id: string }>('SELECT id FROM playbooks WHERE owner_user_id = $1 ORDER BY created_at DESC', [ownerId]);
    const out: Playbook[] = [];
    for (const row of res.rows) {
      const pb = await loadOne(db, ownerId, row.id);
      if (pb) out.push(pb);
    }
    return out;
  });

  app.post('/playbooks', { preHandler: [app.authenticateReal] }, async (req, reply): Promise<Playbook> => {
    await assertFeature(db, req.currentUser.id, 'playbooks');
    const ownerId = await playbookOwner(db, req.currentUser.id);
    await assertCanWrite(db, req.currentUser.id, ownerId);
    const body = asObject(req.body);
    const name = requireString(body, 'name', { min: 1, max: 200 });
    const jurisdiction = parseJurisdiction(body);
    const rules = parseRules(body);
    const id = newId('pb');
    // Encrypt BEFORE the transaction — see writeRules (avoids a PGlite deadlock).
    const encRules = await Promise.all(rules.map((r) => encText(db, ownerId, r)));
    await db.withTx(async (tx) => {
      await tx.query('INSERT INTO playbooks (id, owner_user_id, name, jurisdiction, active) VALUES ($1, $2, $3, $4, true)', [id, ownerId, name, jurisdiction]);
      await writeRules(tx, id, encRules);
    });
    reply.code(201);
    return (await loadOne(db, ownerId, id))!;
  });

  app.patch('/playbooks/:id', { preHandler: [app.authenticateReal] }, async (req): Promise<Playbook> => {
    await assertFeature(db, req.currentUser.id, 'playbooks');
    const ownerId = await playbookOwner(db, req.currentUser.id);
    await assertCanWrite(db, req.currentUser.id, ownerId);
    const { id } = req.params as { id: string };
    const existing = await loadOne(db, ownerId, id);
    if (!existing) throw notFound('Плейбук не найден');
    const body = asObject(req.body);

    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [id, ownerId];
    if (body.name !== undefined) {
      params.push(requireString(body, 'name', { min: 1, max: 200 }));
      sets.push(`name = $${params.length}`);
    }
    if (body.jurisdiction !== undefined) {
      params.push(parseJurisdiction(body));
      sets.push(`jurisdiction = $${params.length}`);
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw badRequest('Поле "active" — булево');
      params.push(body.active);
      sets.push(`active = $${params.length}`);
    }
    // Encrypt BEFORE the transaction — see writeRules (avoids a PGlite deadlock).
    const encRules = body.rules !== undefined ? await Promise.all(parseRules(body).map((r) => encText(db, ownerId, r))) : null;
    await db.withTx(async (tx) => {
      await tx.query(`UPDATE playbooks SET ${sets.join(', ')} WHERE id = $1 AND owner_user_id = $2`, params);
      if (encRules !== null) await writeRules(tx, id, encRules);
    });
    return (await loadOne(db, ownerId, id))!;
  });

  app.delete('/playbooks/:id', { preHandler: [app.authenticateReal] }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'playbooks');
    const ownerId = await playbookOwner(db, req.currentUser.id);
    await assertCanWrite(db, req.currentUser.id, ownerId);
    const { id } = req.params as { id: string };
    const res = await db.query<{ id: string }>('DELETE FROM playbooks WHERE id = $1 AND owner_user_id = $2 RETURNING id', [id, ownerId]);
    if (!res.rows[0]) throw notFound('Плейбук не найден');
    reply.code(204);
  });
}
