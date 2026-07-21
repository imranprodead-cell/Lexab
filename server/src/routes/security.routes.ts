/**
 * SOC2/ISO audit-readiness controls (Этап 5):
 *   POST /me/2fa/setup     — begin TOTP enrolment (returns secret + otpauth URI)
 *   POST /me/2fa/enable     — confirm a code → enable 2FA, return backup codes
 *   POST /me/2fa/disable    — turn 2FA off (password re-auth)
 *   GET  /me/2fa            — status (enabled, backup codes left)
 *   GET  /me/sessions       — recorded active sessions
 *   POST /me/sessions/revoke-others — sign out everywhere (token_version bump)
 *   GET  /me/export         — DSAR: all of the user's data as one JSON archive
 *   GET  /team/access-review[.csv] — who-has-access snapshot (owner/admin)
 *
 * Exports helpers used by the auth login path (TOTP gate + session recording).
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { badRequest, HttpError, notFound, unauthorized } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { decText } from '../lib/docCrypto.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature } from '../lib/limits.ts';
import { verifyPassword } from '../lib/passwords.ts';
import { openSecret, sealSecret } from '../lib/secrets.ts';
import { generateBackupCodes, generateTotpSecret, hashBackupCode, matchTotpStep, otpauthUri } from '../lib/totp.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { getUserByEmail, signToken, toProfile, type UserRow } from '../plugins/auth.ts';

// ─── Helpers shared with the login path ──────────────────────────────────────

/** Record a login session for the "active sessions" view + refresh the member's
 *  last-active stamp for access review (both best-effort). */
export async function recordSession(db: Db, userId: string, ip: string | undefined, userAgent: string | undefined): Promise<void> {
  try {
    await db.query('INSERT INTO user_sessions (id, user_id, ip, user_agent) VALUES ($1, $2, $3, $4)', [
      newId('sess'),
      userId,
      ip ?? null,
      (userAgent ?? '').slice(0, 400) || null,
    ]);
    // Access review: this member was just active in every team they belong to.
    await db.query("UPDATE team_members SET last_active_at = now() WHERE member_user_id = $1 AND status = 'active'", [userId]);
  } catch {
    /* visibility control only — never block a login on it */
  }
}

/**
 * 'disabled' when the user has no 2FA; 'ok' when 2FA is on and `code` is valid;
 * 'required' when 2FA is on and the code is missing/invalid. The caller then
 * falls back to a backup code.
 * Anti-replay (RFC 6238 §5.2): the accepted 30-second step is recorded and a
 * code from the SAME or an earlier step is rejected — the atomic
 * claim-if-newer UPDATE also collapses two concurrent logins with one code.
 */
export async function verifyUserTotp(db: Db, userId: string, code: string | undefined): Promise<'disabled' | 'ok' | 'required' | 'replay'> {
  const res = await db.query<{ secret_sealed: string; enabled: boolean }>('SELECT secret_sealed, enabled FROM user_totp WHERE user_id = $1', [userId]);
  const row = res.rows[0];
  if (!row || !row.enabled) return 'disabled';
  const secret = openSecret(row.secret_sealed);
  if (!secret || !code) return 'required';
  const step = matchTotpStep(secret, code);
  if (step === null) return 'required'; // не тот код — настоящая неудача
  const claimed = await db.query<{ user_id: string }>(
    'UPDATE user_totp SET last_used_step = $2 WHERE user_id = $1 AND (last_used_step IS NULL OR last_used_step < $2) RETURNING user_id',
    [userId, step],
  );
  // Код ВЕРНЫЙ, но этот шаг уже использован (повтор / гонка / рассинхрон часов):
  // доступ не даём, но и неудачной попыткой не считаем — это не перебор.
  return claimed.rows[0] ? 'ok' : 'replay';
}

/** Прунинг журнала сессий: строки старше окна жизни сессии (SESSION_MAX_DAYS)
 *  заведомо мертвы — их токены уже не проходят абсолютный потолок refresh. */
export async function pruneStaleSessions(db: Db): Promise<void> {
  await db.query(`DELETE FROM user_sessions WHERE last_seen_at < now() - ($1 || ' days')::interval`, [
    String(config.sessionMaxDays),
  ]);
}

/** Consume one single-use backup recovery code. Atomic single UPDATE
 *  (jsonb `?` наличие + `-` удаление): гонка двух одновременных логинов с
 *  одним кодом схлопывается — списывает только один. */
export async function consumeBackupCode(db: Db, userId: string, code: string): Promise<boolean> {
  const hash = hashBackupCode(code);
  const res = await db.query<{ user_id: string }>(
    'UPDATE user_totp SET backup_codes = backup_codes - $2 WHERE user_id = $1 AND enabled = true AND backup_codes ? $2 RETURNING user_id',
    [userId, hash],
  );
  return Boolean(res.rows[0]);
}

// ─── DSAR export ─────────────────────────────────────────────────────────────

/** Decrypt a stored value tolerantly (legacy plaintext passes through, a
 *  corrupted value becomes a marker rather than aborting the whole export). */
async function dec(db: Db, ownerId: string, v: string | null): Promise<string | null> {
  if (v === null) return null;
  try {
    return await decText(db, ownerId, v);
  } catch {
    return '[unreadable]';
  }
}

async function buildExport(db: Db, user: UserRow): Promise<Record<string, unknown>> {
  const uid = user.id;
  const sub = await db.query('SELECT plan, status FROM subscriptions WHERE user_id = $1', [uid]);
  const stats = await db.query('SELECT * FROM user_stats WHERE user_id = $1', [uid]);

  const docs = await db.query<{ id: string; name: string; counterparty: string; status: string; risk: string; jurisdiction: string; created_at: Date | string; updated_at: Date | string; deleted_at: Date | string | null }>(
    'SELECT id, name, counterparty, status, risk, jurisdiction, created_at, updated_at, deleted_at FROM documents WHERE user_id = $1 ORDER BY created_at',
    [uid],
  );

  const analyses = await db.query<{ id: string; document_id: string; file_name: string; summary: string; risk_score: number; risk_level: string; created_at: Date | string }>(
    'SELECT id, document_id, file_name, summary, risk_score, risk_level, created_at FROM analyses WHERE user_id = $1 ORDER BY created_at LIMIT 1000',
    [uid],
  );
  const analysesOut = [];
  for (const a of analyses.rows) {
    const findings = await db.query<{ severity: string; title: string; citation: string }>('SELECT severity, title, citation FROM findings WHERE analysis_id = $1 ORDER BY ord', [a.id]);
    analysesOut.push({
      id: a.id,
      documentId: a.document_id,
      fileName: a.file_name,
      summary: await dec(db, uid, a.summary),
      riskScore: a.risk_score,
      riskLevel: a.risk_level,
      createdAt: new Date(a.created_at as string).toISOString(),
      findings: findings.rows,
    });
  }

  const terms = await db.query<{ document_id: string; effective_date: string | null; expiry_date: string | null; auto_renew: boolean | null; renewal_notice_days: number | null; contract_value_enc: string | null; currency: string | null; governing_law: string | null }>(
    "SELECT document_id, to_char(effective_date,'YYYY-MM-DD') AS effective_date, to_char(expiry_date,'YYYY-MM-DD') AS expiry_date, auto_renew, renewal_notice_days, contract_value_enc, currency, governing_law FROM contract_terms WHERE document_id IN (SELECT id FROM documents WHERE user_id = $1)",
    [uid],
  );
  const termsOut = [];
  for (const t of terms.rows) {
    termsOut.push({ ...t, contract_value_enc: undefined, contractValue: await dec(db, uid, t.contract_value_enc) });
  }

  const chats = await db.query<{ id: string; title: string; created_at: Date | string }>('SELECT id, title, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at LIMIT 500', [uid]);
  const chatsOut = [];
  for (const c of chats.rows) {
    const msgs = await db.query<{ role: string; kind: string; text: string | null; file_name: string | null; created_at: Date | string }>(
      'SELECT role, kind, text, file_name, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at LIMIT 1000',
      [c.id],
    );
    const messages = [];
    for (const m of msgs.rows) {
      messages.push({ role: m.role, kind: m.kind, text: await dec(db, uid, m.text), fileName: m.file_name, createdAt: new Date(m.created_at as string).toISOString() });
    }
    chatsOut.push({ id: c.id, title: c.title, createdAt: new Date(c.created_at as string).toISOString(), messages });
  }

  const templates = await db.query<{ title: string; content: string; jurisdiction: string | null; created_at: Date | string }>('SELECT title, content, jurisdiction, created_at FROM saved_templates WHERE user_id = $1 ORDER BY created_at LIMIT 500', [uid]);
  const templatesOut = [];
  for (const t of templates.rows) {
    templatesOut.push({ title: t.title, jurisdiction: t.jurisdiction, content: await dec(db, uid, t.content), createdAt: new Date(t.created_at as string).toISOString() });
  }

  const playbooks = await db.query<{ id: string; name: string; jurisdiction: string | null }>('SELECT id, name, jurisdiction FROM playbooks WHERE owner_user_id = $1 ORDER BY created_at', [uid]);
  const playbooksOut = [];
  for (const p of playbooks.rows) {
    const rules = await db.query<{ text_enc: string }>('SELECT text_enc FROM playbook_rules WHERE playbook_id = $1 ORDER BY ord', [p.id]);
    const decrypted = [];
    for (const r of rules.rows) decrypted.push(await dec(db, uid, r.text_enc));
    playbooksOut.push({ name: p.name, jurisdiction: p.jurisdiction, rules: decrypted });
  }

  const uploads = await db.query<{ file_name: string; size_bytes: number; created_at: Date | string }>('SELECT file_name, size_bytes, created_at FROM uploads WHERE user_id = $1 ORDER BY created_at LIMIT 1000', [uid]);

  return {
    exportedAt: new Date().toISOString(),
    account: { ...toProfile(user), id: uid },
    subscription: sub.rows[0] ?? null,
    stats: stats.rows[0] ?? null,
    documents: docs.rows.map((d) => ({ ...d, created_at: new Date(d.created_at as string).toISOString(), updated_at: new Date(d.updated_at as string).toISOString(), deleted_at: d.deleted_at ? new Date(d.deleted_at as string).toISOString() : null })),
    analyses: analysesOut,
    contractTerms: termsOut,
    chats: chatsOut,
    templates: templatesOut,
    playbooks: playbooksOut,
    uploads: uploads.rows.map((u) => ({ fileName: u.file_name, sizeBytes: Number(u.size_bytes), createdAt: new Date(u.created_at as string).toISOString() })),
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function securityRoutes(app: FastifyInstance, db: Db): void {
  const RATE = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/me/2fa', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ enabled: boolean; backup_codes: string[] | string }>('SELECT enabled, backup_codes FROM user_totp WHERE user_id = $1', [req.currentUser.id]);
    const row = res.rows[0];
    const codes: string[] = row ? (typeof row.backup_codes === 'string' ? JSON.parse(row.backup_codes) : row.backup_codes) : [];
    return { enabled: Boolean(row?.enabled), backupCodesRemaining: row?.enabled ? codes.length : 0 };
  });

  // Begin enrolment: mint a secret, seal it, store as pending (enabled=false).
  app.post('/me/2fa/setup', { preHandler: [app.authenticateReal], config: RATE }, async (req) => {
    const existing = await db.query<{ enabled: boolean }>('SELECT enabled FROM user_totp WHERE user_id = $1', [req.currentUser.id]);
    if (existing.rows[0]?.enabled) throw badRequest('Двухфакторная аутентификация уже включена');
    const secret = generateTotpSecret();
    const sealed = sealSecret(secret);
    await db.query(
      `INSERT INTO user_totp (user_id, secret_sealed, enabled, backup_codes) VALUES ($1, $2, false, '[]'::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET secret_sealed = EXCLUDED.secret_sealed, enabled = false, backup_codes = '[]'::jsonb, confirmed_at = NULL`,
      [req.currentUser.id, sealed],
    );
    return { secret, otpauthUri: otpauthUri(secret, req.currentUser.email) };
  });

  // Confirm a code from the app → enable, and hand back one-time backup codes.
  app.post('/me/2fa/enable', { preHandler: [app.authenticateReal], config: RATE }, async (req) => {
    const body = asObject(req.body);
    const code = requireString(body, 'code', { min: 6, max: 10 });
    const res = await db.query<{ secret_sealed: string; enabled: boolean }>('SELECT secret_sealed, enabled FROM user_totp WHERE user_id = $1', [req.currentUser.id]);
    const row = res.rows[0];
    if (!row) throw badRequest('Сначала начните настройку (2fa/setup)');
    if (row.enabled) throw badRequest('Двухфакторная аутентификация уже включена');
    const secret = openSecret(row.secret_sealed);
    const step = secret ? matchTotpStep(secret, code) : null;
    if (step === null) throw badRequest('Неверный код — попробуйте ещё раз');
    const backupCodes = generateBackupCodes();
    const hashes = backupCodes.map(hashBackupCode);
    // Записываем и шаг кода подтверждения — его повтор при первом входе не пройдёт.
    await db.query('UPDATE user_totp SET enabled = true, confirmed_at = now(), backup_codes = $2, last_used_step = $3 WHERE user_id = $1', [req.currentUser.id, JSON.stringify(hashes), step]);
    await audit(db, req, { type: 'auth.totp_enabled', teamOwnerId: req.currentUser.id });
    // Shown ONCE — the server keeps only hashes.
    return { enabled: true, backupCodes };
  });

  // Disable 2FA — requires the account password (step-up re-auth).
  app.post('/me/2fa/disable', { preHandler: [app.authenticateReal], config: RATE }, async (req) => {
    const body = asObject(req.body);
    const password = requireString(body, 'password', { min: 1, max: 200 });
    const user = await getUserByEmail(db, req.currentUser.email);
    if (!user || !(await verifyPassword(password, user.password_hash))) throw unauthorized('Пароль неверен');
    await db.query('DELETE FROM user_totp WHERE user_id = $1', [req.currentUser.id]);
    await audit(db, req, { type: 'auth.totp_disabled', teamOwnerId: req.currentUser.id });
    return { enabled: false };
  });

  app.get('/me/sessions', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ id: string; ip: string | null; user_agent: string | null; created_at: Date | string; last_seen_at: Date | string }>(
      'SELECT id, ip, user_agent, created_at, last_seen_at FROM user_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 50',
      [req.currentUser.id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: new Date(r.created_at as string).toISOString(),
      lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
    }));
  });

  // Sign out everywhere: bump token_version (invalidates every issued token),
  // clear the session log, and return a fresh token so THIS client stays in.
  app.post('/me/sessions/revoke-others', { preHandler: [app.authenticateReal], config: RATE }, async (req) => {
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.currentUser.id]);
    await db.query('DELETE FROM user_sessions WHERE user_id = $1', [req.currentUser.id]);
    await recordSession(db, req.currentUser.id, req.ip, req.headers['user-agent']);
    const fresh = await db.query<UserRow>('SELECT id, email, name, initials, firm, jurisdiction, avatar_url, token_version, email_verified FROM users WHERE id = $1', [req.currentUser.id]);
    await audit(db, req, { type: 'auth.sessions_revoked', teamOwnerId: req.currentUser.id });
    return { token: signToken(app, fresh.rows[0]), user: toProfile(fresh.rows[0]) };
  });

  // DSAR — portable archive of everything this account holds (JSON download).
  app.get('/me/export', { preHandler: [app.authenticate], config: RATE }, async (req, reply) => {
    const user = await db.query<UserRow>('SELECT id, email, name, initials, firm, jurisdiction, avatar_url, token_version, email_verified FROM users WHERE id = $1', [req.currentUser.id]);
    const data = await buildExport(db, user.rows[0]);
    await audit(db, req, { type: 'user.data_exported', teamOwnerId: req.currentUser.id });
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="lexai-data-export.json"');
    return data;
  });

  // Access review: who is on the team and when they last acted (owner/admin).
  app.get('/team/access-review', { preHandler: [app.authenticate] }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'team');
    const rows = await accessReviewRows(db, req.currentUser.id);
    return rows;
  });

  app.get('/team/access-review.csv', { preHandler: [app.authenticate] }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'team');
    const rows = await accessReviewRows(db, req.currentUser.id);
    const esc = (v: unknown) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // OWASP CSV-injection defense
      s = s.replace(/\r\n?/g, '\n');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'name,email,role,status,last_active\n';
    const body = rows.map((r) => [r.name, r.email, r.role, r.status, r.lastActiveAt ?? 'never'].map(esc).join(',')).join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="access-review.csv"');
    return header + body;
  });
}

interface AccessRow {
  name: string;
  email: string;
  role: string;
  status: string;
  lastActiveAt: string | null;
}

/** The owner + every member of their team, with roles + last-active. */
async function accessReviewRows(db: Db, userId: string): Promise<AccessRow[]> {
  // The team owner is `userId` unless they are themselves a member of another
  // owner's team — mirror the pattern used elsewhere (a "team" = owner + members).
  const ownerRes = await db.query<{ owner_user_id: string }>(
    "SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND status = 'active' AND owner_user_id <> $1 LIMIT 1",
    [userId],
  );
  const ownerId = ownerRes.rows[0]?.owner_user_id ?? userId;

  const owner = await db.query<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = $1', [ownerId]);
  const members = await db.query<{ name: string; email: string; role: string; status: string; last_active_at: Date | string | null }>(
    `SELECT COALESCE(u.name, tm.email) AS name, tm.email, tm.role, tm.status,
            tm.last_active_at
     FROM team_members tm LEFT JOIN users u ON u.id = tm.member_user_id
     WHERE tm.owner_user_id = $1 AND tm.owner_user_id <> tm.member_user_id
     ORDER BY tm.created_at`,
    [ownerId],
  );
  const out: AccessRow[] = [];
  if (owner.rows[0]) out.push({ name: owner.rows[0].name, email: owner.rows[0].email, role: 'owner', status: 'active', lastActiveAt: null });
  for (const m of members.rows) {
    out.push({ name: m.name, email: m.email, role: m.role, status: m.status, lastActiveAt: m.last_active_at ? new Date(m.last_active_at as string).toISOString() : null });
  }
  return out;
}
