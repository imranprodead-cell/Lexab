/**
 * POST /auth/register | /auth/login | /auth/logout
 * POST /auth/verify { token } | /auth/verify/resend      — email confirmation
 * POST /auth/reset { email } | /auth/reset/confirm       — password recovery
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest, HttpError, unauthorized } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { hashPassword, verifyPassword } from '../lib/passwords.ts';
import { isPasswordBreached } from '../lib/hibp.ts';
import { consumeBackupCode, recordSession, verifyUserTotp } from './security.routes.ts';
import { asObject, requireEmail, requireString } from '../lib/validate.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { notify } from '../lib/notify.ts';
import { recordBillingEvent, TERMS_VERSION } from '../lib/billing.ts';
import { audit, countRecent } from '../lib/audit.ts';
import { assertSsoNotRequired } from './sso.routes.ts';
import { deleteFile } from '../storage.ts';
import { getUserByEmail, getUserById, signToken, toProfile, type UserRow } from '../plugins/auth.ts';

const RATE_LIMIT = { rateLimit: { max: config.authRateLimitMax, timeWindow: '1 minute' } };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// A throw-away scrypt hash used when the login email doesn't exist, so an
// unknown-account login costs the same time as a real one — closing the
// account-enumeration timing oracle. Computed once, lazily.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(crypto.randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

// One identical failure for every bad-credentials case (unknown email, wrong
// password, Google-only account) so the response never reveals which emails
// have accounts. Legitimate Google users are guided by the "Continue with
// Google" button on the login screen, not by a distinct error here.
const LOGIN_FAILED = 'Неверный email или пароль / Invalid email or password';

const BREACHED_PASSWORD_MSG =
  'Этот пароль встречается в утечках данных — выберите другой / This password appears in known data breaches — choose a different one';

export async function sendVerificationMail(db: Db, userId: string, email: string, name: string): Promise<void> {
  const token = newToken();
  // The link expires (24h) — a verification token must not stay valid forever
  // in a mailbox; resend is one click away (login / the bell button).
  await db.query(`UPDATE users SET verify_token = $2, verify_expires = now() + interval '24 hours' WHERE id = $1`, [
    userId,
    token,
  ]);
  const url = `${config.appBaseUrl}/verify-email?token=${token}`;
  void sendMail({
    to: email,
    subject: 'Подтвердите почту в LexAI',
    html: mailLayout(
      'Подтвердите вашу почту',
      `<p>Здравствуйте, <strong>${escapeMailHtml(name)}</strong>!</p>
       <p>Нажмите кнопку, чтобы подтвердить адрес <strong>${escapeMailHtml(email)}</strong> и открыть все возможности LexAI — включая приглашения в команды. Ссылка действует <strong>24 часа</strong>.</p>`,
      'Подтвердить почту',
      url,
    ),
  });
}

export function authRoutes(app: FastifyInstance, db: Db): void {
  app.post('/auth/register', { config: RATE_LIMIT }, async (req, reply) => {
    const body = asObject(req.body);
    const name = requireString(body, 'name', { min: 1, max: 200 });
    const email = requireEmail(body);
    const password = requireString(body, 'password', { min: 8, max: 200 });
    // Reject passwords known to be breached (HIBP k-anonymity; fail-open). Done
    // BEFORE the enumeration-safe existing-account branch so a weak password is
    // caught even when re-registering — the message reveals nothing about the email.
    if (await isPasswordBreached(password)) throw new HttpError(400, BREACHED_PASSWORD_MSG);

    const existing = await getUserByEmail(db, email);
    if (existing) {
      // Anti-enumeration: reply EXACTLY as for a brand-new signup (same status,
      // body and — via the dummy scrypt — timing), so /register never becomes an
      // oracle for "which emails have accounts" (or which use Google). The real
      // owner is guided in instead, out-of-band by email.
      await hashPassword(password);
      void sendMail({
        to: existing.email,
        subject: 'Попытка регистрации в LexAI',
        html: mailLayout(
          'У вас уже есть аккаунт LexAI',
          `<p>Кто-то попытался зарегистрироваться с вашим адресом <strong>${escapeMailHtml(existing.email)}</strong>.</p>
           <p>${
             existing.google_sub
               ? 'Ваш аккаунт привязан ко входу через Google — используйте кнопку «Продолжить с Google».'
               : 'Если это были вы — просто войдите. Забыли пароль? Воспользуйтесь восстановлением пароля.'
           }</p>`,
          'Войти в LexAI',
          `${config.appBaseUrl}/login`,
        ),
      });
      reply.code(201);
      return { ok: true, verifyRequired: true, email };
    }

    const id = newId('u');
    const passwordHash = await hashPassword(password);
    // The account row and its Free subscription + stats commit together, so a
    // partial failure can't leave a user without a plan or a stats row.
    await db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, email, passwordHash, name, initialsOf(name), 'LexAI', 'United Kingdom'],
      );
      await tx.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'Free', 'active')`, [id]);
      await tx.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [id]);
      // Record which Terms version this account accepted at signup (the auth
      // page shows the "by continuing you accept…" notice) — legal evidence.
      await recordBillingEvent(tx, {
        userId: id,
        email,
        kind: 'terms_accepted',
        payload: { ip: req.ip, termsVersion: TERMS_VERSION, at: 'signup' },
      });
    });
    await notify(db, id, 'docs', 'Добро пожаловать в LexAI!', 'Welcome to LexAI!', {
      bodyRu: 'Загрузите первый контракт для анализа',
      bodyEn: 'Upload your first contract for review',
    });

    await sendVerificationMail(db, id, email, name);
    await audit(db, req, { type: 'auth.register', actorId: id, actorLabel: email, teamOwnerId: id });

    // No session until the mailbox is proven — otherwise anyone could sign up
    // with someone else's address and use the account under their email.
    reply.code(201);
    return { ok: true, verifyRequired: true, email };
  });

  // Verify the email by the token from the letter (public — works on any device).
  app.post('/auth/verify', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const token = requireString(body, 'token', { min: 10, max: 100 });
    // Find the user by the token FIRST and check SSO BEFORE any mutation, so an
    // SSO-only member gets the clear 403 with NO side effects (their token is
    // not consumed and email_verified is left untouched).
    const found = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE verify_token = $1 AND verify_expires > now()`,
      [token],
    );
    const row = found.rows[0];
    if (!row) throw badRequest('Ссылка недействительна, истекла или уже использована — запросите письмо ещё раз');
    await assertSsoNotRequired(db, { id: row.id, email: row.email });
    // Only now consume the token and mark the mailbox proven.
    await db.query(
      `UPDATE users SET email_verified = true, verify_token = NULL, verify_expires = NULL WHERE id = $1`,
      [row.id],
    );
    // Owning the mailbox proves the email → sign the user in right away.
    const user = (await getUserById(db, row.id)) as UserRow;
    return { ok: true, token: signToken(app, user), user: toProfile(user) };
  });

  // Logged-in user asks for the letter again.
  app.post(
    '/auth/verify/resend',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req) => {
      if (req.currentUser.email_verified) return { ok: true, already: true };
      await sendVerificationMail(db, req.currentUser.id, req.currentUser.email, req.currentUser.name);
      return { ok: true };
    },
  );

  app.post('/auth/login', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const email = requireEmail(body);
    const password = requireString(body, 'password', { min: 1, max: 200 });

    // Record a failed attempt and, if the per-ip/email rate is suspicious, fire
    // one deduped security alert (audit event + notify + email to the account).
    const onFailure = async () => {
      await audit(db, req, { type: 'auth.login_failed', actorId: null, actorLabel: email, status: 'denied', metadata: { email } });
      const recent = await countRecent(db, 'auth.login_failed', 5, req.ip, email);
      if (recent >= config.authBruteforceThreshold) {
        // Dedupe: at most one alert per ip/email per hour.
        const alerts = await countRecent(db, 'security.bruteforce_alert', 60, req.ip, email);
        if (alerts === 0) {
          await audit(db, req, { type: 'security.bruteforce_alert', actorId: null, actorLabel: email, status: 'denied', metadata: { email, count: recent } });
          const target = await getUserByEmail(db, email);
          if (target) {
            await notify(db, target.id, 'alert', 'Подозрительные попытки входа', 'Suspicious login attempts', {
              bodyRu: `${recent} неудачных попыток входа за 5 минут`,
              bodyEn: `${recent} failed login attempts in 5 minutes`,
            });
            void sendMail({
              to: target.email,
              subject: 'LexAI: подозрительная активность входа',
              html: mailLayout(
                'Замечены подозрительные попытки входа',
                `<p>За последние 5 минут в ваш аккаунт было <strong>${recent}</strong> неудачных попыток входа. Если это были не вы — смените пароль.</p>`,
                'Сменить пароль',
                `${config.appBaseUrl}/settings`,
              ),
            });
          }
        }
      }
    };

    const user = await getUserByEmail(db, email);
    if (!user) {
      // Unknown email: still run scrypt (against a throw-away hash) so the reply
      // isn't measurably faster than for a real account.
      await verifyPassword(password, await dummyHash());
      await onFailure();
      throw unauthorized(LOGIN_FAILED);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      // Wrong password — and a Google-only account (random unknown password)
      // lands here too. Same generic message: never disclose account existence.
      await onFailure();
      throw unauthorized(LOGIN_FAILED);
    }
    if (!user.email_verified) {
      // Password is correct, but the mailbox was never proven — resend the
      // confirmation link instead of opening the session.
      await sendVerificationMail(db, user.id, user.email, user.name);
      throw new HttpError(
        403,
        `Сначала подтвердите почту: новое письмо отправлено на ${user.email} / Verify your email first: a new link was sent to ${user.email}`,
      );
    }
    // If the user's org enforces SSO, password login is blocked (owner exempt).
    await assertSsoNotRequired(db, { id: user.id, email: user.email });

    // Second factor: when 2FA is enabled, a correct password alone is not enough.
    // The client re-submits with { code } (TOTP) or { backupCode } (recovery).
    const suppliedCode = typeof body.code === 'string' ? body.code : undefined;
    const totp = await verifyUserTotp(db, user.id, suppliedCode);
    if (totp === 'required') {
      const backup = typeof body.backupCode === 'string' ? body.backupCode : undefined;
      const used = backup ? await consumeBackupCode(db, user.id, backup) : false;
      if (!used) {
        // The bare password step of a NORMAL 2FA login is a challenge, not a
        // failure — logging it would let every successful 2FA sign-in feed the
        // brute-force detector. Only a supplied-but-WRONG code counts as failed.
        if (suppliedCode !== undefined || backup !== undefined) await onFailure();
        // Distinct, non-enumerating: the password already verified above, so this
        // only tells an already-authenticated-by-password caller to add the code.
        throw new HttpError(401, 'Нужен код двухфакторной аутентификации / Two-factor code required', 'totp_required');
      }
    }

    await audit(db, req, { type: 'auth.login', actorId: user.id, actorLabel: user.email, teamOwnerId: user.id });
    await recordSession(db, user.id, req.ip, req.headers['user-agent']);
    return { token: signToken(app, user), user: toProfile(user) };
  });

  // Sliding session: a live token is exchanged for a fresh full-lifetime one.
  // An expired or revoked (token_version bump) token gets the standard 401 —
  // the client then sends the user to the login screen instead of a dead page.
  // Guards mirror the other token-issuing routes (a refresh chain must not
  // outlive what a fresh login would allow):
  //  - unverified email → 401 (login refuses it too; e.g. after an email change)
  //  - org enforces SSO → 401, so the user re-enters through the IdP
  //  - absolute cap: once the ORIGINAL sign-in (auth_at) is older than
  //    SESSION_MAX_DAYS, renewal stops — a stolen token can't self-renew forever.
  app.post('/auth/refresh', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req) => {
    if (!req.currentUser.email_verified) throw unauthorized();
    try {
      await assertSsoNotRequired(db, { id: req.currentUser.id, email: req.currentUser.email });
    } catch {
      throw unauthorized(); // 401 (not 403): the client must drop the session and re-login via SSO
    }
    const raw = (req.headers.authorization ?? '').slice(7);
    const payload = app.jwt.decode<{ iat?: number; auth_at?: number }>(raw);
    const authAt = payload?.auth_at ?? payload?.iat ?? Math.floor(Date.now() / 1000);
    if (Date.now() / 1000 - authAt > config.sessionMaxDays * 86400) throw unauthorized();
    await audit(db, req, { type: 'auth.refresh', teamOwnerId: req.currentUser.id });
    // Сессии — visibility-контроль без привязки токен↔строка: считаем живой ту,
    // что была активна последней (лучшее приближение), и штампуем её.
    void db
      .query(
        `UPDATE user_sessions SET last_seen_at = now()
         WHERE id = (SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 1)`,
        [req.currentUser.id],
      )
      .catch(() => undefined);
    return { token: signToken(app, req.currentUser, authAt), user: toProfile(req.currentUser) };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req, reply) => {
    // Bump token_version → all previously issued tokens become invalid.
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.currentUser.id]);
    await audit(db, req, { type: 'auth.logout', teamOwnerId: req.currentUser.id });
    reply.code(204);
  });

  // Request a reset link. Always 204 — never reveals whether the address exists.
  app.post('/auth/reset', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = asObject(req.body);
    const email = requireEmail(body);
    // ALL account-dependent work (lookup, token write, mail) runs in the
    // background AFTER the response: a known email must not answer slower than
    // an unknown one, or response timing becomes an account-enumeration oracle.
    void (async () => {
      const user = await getUserByEmail(db, email);
      if (!user) return;
      const token = newToken();
      await db.query(
        `UPDATE users SET reset_token = $2, reset_expires = now() + interval '1 hour' WHERE id = $1`,
        [user.id, token],
      );
      const url = `${config.appBaseUrl}/reset-password?token=${token}`;
      void sendMail({
        to: user.email,
        subject: 'Сброс пароля LexAI',
        html: mailLayout(
          'Сброс пароля',
          `<p>Здравствуйте, <strong>${escapeMailHtml(user.name)}</strong>!</p>
           <p>Вы (или кто-то другой) запросили сброс пароля для этого аккаунта. Ссылка действует <strong>1 час</strong>.</p>
           <p>Если это были не вы — просто проигнорируйте письмо, пароль не изменится.</p>`,
          'Задать новый пароль',
          url,
        ),
      });
    })().catch((err) => req.log.error(err, 'reset request failed'));
    reply.code(204);
  });

  // Set a new password by the token; all old sessions are invalidated.
  app.post('/auth/reset/confirm', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const token = requireString(body, 'token', { min: 10, max: 100 });
    const password = requireString(body, 'password', { min: 8, max: 200 });
    if (await isPasswordBreached(password)) throw new HttpError(400, BREACHED_PASSWORD_MSG);

    const found = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE reset_token = $1 AND reset_expires > now()`,
      [token],
    );
    const row = found.rows[0];
    if (!row) throw badRequest('Ссылка недействительна или истекла — запросите сброс ещё раз');
    // Check SSO BEFORE mutating anything: an SSO-only member must get the clear
    // 403 without their password being silently changed or token_version bumped
    // (which would otherwise leave them altered but without a session).
    await assertSsoNotRequired(db, { id: row.id, email: row.email });

    // 2FA: сброс пароля не должен обходить второй фактор — иначе доступ к
    // почте равен захвату аккаунта несмотря на включённую 2FA. Челлендж
    // бросается ДО каких-либо мутаций: reset-токен не расходуется, пользователь
    // повторяет запрос с кодом (или резервным кодом).
    const resetTotp = await verifyUserTotp(db, row.id, typeof body.code === 'string' ? body.code : undefined);
    if (resetTotp === 'required') {
      const backup = typeof body.backupCode === 'string' ? body.backupCode : undefined;
      const used = backup ? await consumeBackupCode(db, row.id, backup) : false;
      if (!used) {
        throw new HttpError(401, 'Нужен код двухфакторной аутентификации / Two-factor code required', 'totp_required');
      }
    }

    const passwordHash = await hashPassword(password);
    await db.query(
      `UPDATE users SET password_hash = $2, reset_token = NULL, reset_expires = NULL,
        email_verified = true, verify_token = NULL, verify_expires = NULL, token_version = token_version + 1
       WHERE id = $1`,
      [row.id, passwordHash],
    );
    // Owning the mailbox proves the email → auto-login with a fresh session.
    const fresh = (await getUserById(db, row.id)) as UserRow;
    await audit(db, req, { type: 'auth.password_reset', actorId: fresh.id, actorLabel: fresh.email, teamOwnerId: fresh.id });
    return { token: signToken(app, fresh), user: toProfile(fresh) };
  });

  // Change password. Verifies the current one, then invalidates all previously
  // issued tokens (token_version bump) and returns a fresh token.
  app.post('/auth/password', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const currentPassword = requireString(body, 'currentPassword', { min: 1, max: 200 });
    const newPassword = requireString(body, 'newPassword', { min: 8, max: 200 });
    if (await isPasswordBreached(newPassword)) throw new HttpError(400, BREACHED_PASSWORD_MSG);

    const user = await getUserByEmail(db, req.currentUser.email);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw unauthorized('Текущий пароль неверен');
    }
    const passwordHash = await hashPassword(newPassword);
    await db.query('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [
      user.id,
      passwordHash,
    ]);
    const fresh = (await getUserById(db, user.id)) as UserRow;
    await audit(db, req, { type: 'auth.password_changed', teamOwnerId: user.id });
    return { token: signToken(app, fresh), user: toProfile(fresh) };
  });

  // Delete the account and every piece of data it owns (FK cascades).
  // Requires typing the account email as confirmation.
  app.delete('/me', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req, reply) => {
    const body = asObject(req.body);
    const confirm = requireString(body, 'confirm', { min: 3, max: 320 });
    if (confirm.toLowerCase() !== req.currentUser.email.toLowerCase()) {
      throw new HttpError(400, 'Подтверждение не совпадает с email аккаунта');
    }
    // Remember where the uploaded bytes live BEFORE the CASCADE wipes the rows.
    const files = await db.query<{ storage: 's3' | 'local' | 'supabase'; storage_key: string }>(
      'SELECT storage, storage_key FROM uploads WHERE user_id = $1',
      [req.currentUser.id],
    );
    // Log before the CASCADE removes the user (and their own audit rows).
    // If this user is a member of someone ELSE's team, attribute the deletion to
    // that team OWNER: audit_events.team_owner_id → the owner, who is NOT being
    // deleted, so their row survives the CASCADE and the owner keeps a visible
    // record of the member leaving. For a solo user (no external owner) we keep
    // teamOwnerId = self on purpose — the event is written under the user's own
    // row and the CASCADE wipes it, which is the intended GDPR self-erasure
    // (migration 030), not a lost trail.
    const owner = await db.query<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND owner_user_id <> $1 LIMIT 1',
      [req.currentUser.id],
    );
    const auditOwnerId = owner.rows[0]?.owner_user_id ?? req.currentUser.id;
    await audit(db, req, { type: 'auth.account_deleted', teamOwnerId: auditOwnerId });
    await db.query('DELETE FROM users WHERE id = $1', [req.currentUser.id]);
    // Best effort: a failed storage delete must not keep the account alive.
    for (const row of files.rows) {
      try {
        await deleteFile(row.storage, row.storage_key);
      } catch (err) {
        req.log.warn({ err, key: row.storage_key }, 'storage: delete failed');
      }
    }
    reply.code(204);
  });
}
