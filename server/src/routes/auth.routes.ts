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
import { asObject, requireEmail, requireString } from '../lib/validate.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { notify } from '../lib/notify.ts';
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

export async function sendVerificationMail(db: Db, userId: string, email: string, name: string): Promise<void> {
  const token = newToken();
  await db.query('UPDATE users SET verify_token = $2 WHERE id = $1', [userId, token]);
  const url = `${config.appBaseUrl}/verify-email?token=${token}`;
  void sendMail({
    to: email,
    subject: 'Подтвердите почту в LexAI',
    html: mailLayout(
      'Подтвердите вашу почту',
      `<p>Здравствуйте, <strong>${escapeMailHtml(name)}</strong>!</p>
       <p>Нажмите кнопку, чтобы подтвердить адрес <strong>${escapeMailHtml(email)}</strong> и открыть все возможности LexAI — включая приглашения в команды.</p>`,
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
    });
    await notify(db, id, 'docs', 'Добро пожаловать в LexAI!', 'Welcome to LexAI!', {
      bodyRu: 'Загрузите первый контракт для анализа',
      bodyEn: 'Upload your first contract for review',
    });

    await sendVerificationMail(db, id, email, name);

    // No session until the mailbox is proven — otherwise anyone could sign up
    // with someone else's address and use the account under their email.
    reply.code(201);
    return { ok: true, verifyRequired: true, email };
  });

  // Verify the email by the token from the letter (public — works on any device).
  app.post('/auth/verify', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const token = requireString(body, 'token', { min: 10, max: 100 });
    const res = await db.query<{ id: string }>(
      `UPDATE users SET email_verified = true, verify_token = NULL WHERE verify_token = $1 RETURNING id`,
      [token],
    );
    if (!res.rows[0]) throw badRequest('Ссылка недействительна или уже использована');
    // Owning the mailbox proves the email → sign the user in right away.
    const user = (await getUserById(db, res.rows[0].id)) as UserRow;
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

    const user = await getUserByEmail(db, email);
    if (!user) {
      // Unknown email: still run scrypt (against a throw-away hash) so the reply
      // isn't measurably faster than for a real account.
      await verifyPassword(password, await dummyHash());
      throw unauthorized(LOGIN_FAILED);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      // Wrong password — and a Google-only account (random unknown password)
      // lands here too. Same generic message: never disclose account existence.
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
    return { token: signToken(app, user), user: toProfile(user) };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req, reply) => {
    // Bump token_version → all previously issued tokens become invalid.
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.currentUser.id]);
    reply.code(204);
  });

  // Request a reset link. Always 204 — never reveals whether the address exists.
  app.post('/auth/reset', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = asObject(req.body);
    const email = requireEmail(body);
    const user = await getUserByEmail(db, email);
    if (user) {
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
    }
    reply.code(204);
  });

  // Set a new password by the token; all old sessions are invalidated.
  app.post('/auth/reset/confirm', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const token = requireString(body, 'token', { min: 10, max: 100 });
    const password = requireString(body, 'password', { min: 8, max: 200 });

    const found = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE reset_token = $1 AND reset_expires > now()`,
      [token],
    );
    const row = found.rows[0];
    if (!row) throw badRequest('Ссылка недействительна или истекла — запросите сброс ещё раз');

    const passwordHash = await hashPassword(password);
    await db.query(
      `UPDATE users SET password_hash = $2, reset_token = NULL, reset_expires = NULL,
        email_verified = true, verify_token = NULL, token_version = token_version + 1
       WHERE id = $1`,
      [row.id, passwordHash],
    );
    // Owning the mailbox proves the email → auto-login with a fresh session.
    const fresh = (await getUserById(db, row.id)) as UserRow;
    return { token: signToken(app, fresh), user: toProfile(fresh) };
  });

  // Change password. Verifies the current one, then invalidates all previously
  // issued tokens (token_version bump) and returns a fresh token.
  app.post('/auth/password', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const currentPassword = requireString(body, 'currentPassword', { min: 1, max: 200 });
    const newPassword = requireString(body, 'newPassword', { min: 8, max: 200 });

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
