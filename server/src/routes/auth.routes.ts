/** POST /auth/login | /auth/register | /auth/logout | /auth/reset */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { HttpError, unauthorized } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { hashPassword, verifyPassword } from '../lib/passwords.ts';
import { asObject, requireEmail, requireString } from '../lib/validate.ts';
import { getUserByEmail, getUserById, signToken, toProfile, type UserRow } from '../plugins/auth.ts';

const RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function authRoutes(app: FastifyInstance, db: Db): void {
  app.post('/auth/register', { config: RATE_LIMIT }, async (req, reply) => {
    const body = asObject(req.body);
    const name = requireString(body, 'name', { min: 1, max: 200 });
    const email = requireEmail(body);
    const password = requireString(body, 'password', { min: 8, max: 200 });

    const existing = await getUserByEmail(db, email);
    if (existing) throw new HttpError(409, 'An account with this email already exists');

    const id = newId('u');
    const passwordHash = await hashPassword(password);
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, email, passwordHash, name, initialsOf(name), 'LexAI', 'United Kingdom'],
    );
    await db.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'Free', 'active')`, [id]);
    await db.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [id]);
    await db.query(
      `INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'docs', $3)`,
      [newId('n'), id, 'Добро пожаловать в LexAI! Загрузите первый контракт для анализа.'],
    );

    const user = (await getUserById(db, id)) as UserRow;
    reply.code(201);
    return { token: signToken(app, user), user: toProfile(user) };
  });

  app.post('/auth/login', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const email = requireEmail(body);
    const password = requireString(body, 'password', { min: 1, max: 200 });

    const user = await getUserByEmail(db, email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw unauthorized('Invalid email or password');
    }
    return { token: signToken(app, user), user: toProfile(user) };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req, reply) => {
    // Bump token_version → all previously issued tokens become invalid.
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.currentUser.id]);
    reply.code(204);
  });

  app.post('/auth/reset', { config: RATE_LIMIT }, async (req, reply) => {
    const body = asObject(req.body);
    requireEmail(body);
    // Always 204 — never reveal whether the address exists. Hook up an email
    // provider (SES/Postmark/…) here to actually deliver the reset link.
    reply.code(204);
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
    if (req.currentUser.id === 'u_demo') {
      throw new HttpError(400, 'Демо-аккаунт удалить нельзя');
    }
    await db.query('DELETE FROM users WHERE id = $1', [req.currentUser.id]);
    reply.code(204);
  });
}
