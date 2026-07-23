/**
 * JWT auth. Every protected route uses the `authenticate` preHandler.
 *
 * Tokens carry { sub: userId, tv: tokenVersion }. Logout bumps the user's
 * token_version, invalidating all previously issued tokens.
 *
 * A missing or invalid token is always a 401 — there is NO demo-user fallback.
 * `authenticate` and `authenticateReal` behave identically except for the error
 * message; both require a valid signed token for a real, existing user.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { unauthorized } from '../lib/errors.ts';
import type { UserProfile } from '../types.ts';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  initials: string;
  firm: string;
  jurisdiction: string;
  avatar_url: string | null;
  token_version: number;
  email_verified: boolean;
  google_sub?: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Like authenticate, but NEVER falls back to the demo user — AI endpoints
     *  use this so an invalid token cannot burn the Anthropic key. */
    authenticateReal: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** authenticate с 30-сек кэшем позитивных резолвов — ТОЛЬКО для роутов
     *  озвучки: срезает DB round-trip (~0.5–1 с до Supabase) с каждого клика.
     *  Отзыв сессии в этом же инстансе мгновенный (invalidateTtsAuthCache
     *  дёргается при logout/смене пароля/ревокации); в мульти-инстансе окно
     *  ≤30 с — осознанный компромисс: ущерб ограничен rate-limit озвучки и
     *  дневным потолком символов. */
    authenticateTts: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    currentUser: UserRow;
  }
}

const ttsAuthCache = new Map<string, { user: UserRow; exp: number }>();
const TTS_AUTH_CACHE_TTL_MS = 30_000;

/** Мгновенная (в рамках инстанса) инвалидация TTS-кэша авторизации — вызывать
 *  при любом bump token_version и удалении аккаунта. Без userId — полный сброс. */
export function invalidateTtsAuthCache(userId?: string): void {
  if (!userId) {
    ttsAuthCache.clear();
    return;
  }
  for (const [k, v] of ttsAuthCache) {
    if (v.user.id === userId) ttsAuthCache.delete(k);
  }
}

export function toProfile(row: UserRow): UserProfile {
  return {
    name: row.name,
    initials: row.initials,
    firm: row.firm,
    jurisdiction: row.jurisdiction,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const res = await db.query<UserRow>(
    'SELECT id, email, name, initials, firm, jurisdiction, avatar_url, token_version, email_verified FROM users WHERE id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function getUserByEmail(db: Db, email: string): Promise<(UserRow & { password_hash: string }) | null> {
  const res = await db.query<UserRow & { password_hash: string }>(
    'SELECT id, email, name, initials, firm, jurisdiction, avatar_url, token_version, email_verified, google_sub, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  return res.rows[0] ?? null;
}

export function registerAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('currentUser');

  /** Resolve a verified JWT to its user, or null. */
  async function resolveToken(req: FastifyRequest): Promise<UserRow | null> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    try {
      const payload = app.jwt.verify<{ sub: string; tv: number }>(token);
      const user = await getUserById(db, payload.sub);
      if (user && user.token_version === payload.tv) return user;
    } catch {
      /* invalid/expired token */
    }
    return null;
  }

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const user = await resolveToken(req);
    if (user) {
      req.currentUser = user;
      return;
    }
    throw unauthorized();
  });

  // Strict variant for AI endpoints: a real signed-in session only.
  app.decorate('authenticateReal', async (req: FastifyRequest) => {
    const user = await resolveToken(req);
    if (!user) throw unauthorized('Войдите в аккаунт, чтобы использовать ИИ');
    req.currentUser = user;
  });

  // Кэширующий вариант для озвучки (см. комментарий в декларации типа).
  app.decorate('authenticateTts', async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const hit = ttsAuthCache.get(token);
      if (hit && hit.exp > Date.now()) {
        req.currentUser = hit.user;
        return;
      }
    }
    const user = await resolveToken(req);
    if (!user) throw unauthorized('Войдите в аккаунт, чтобы использовать ИИ');
    req.currentUser = user;
    if (token) {
      if (ttsAuthCache.size > 500) {
        const now = Date.now();
        for (const [k, v] of ttsAuthCache) if (v.exp <= now) ttsAuthCache.delete(k);
      }
      ttsAuthCache.set(token, { user, exp: Date.now() + TTS_AUTH_CACHE_TTL_MS });
    }
  });
}

/**
 * `auth_at` = when the user last proved their identity (password/link/IdP).
 * /auth/refresh carries it over unchanged, so a refresh chain can be capped at
 * an absolute age (config.sessionMaxDays) no matter how often it renews.
 */
export function signToken(app: FastifyInstance, user: UserRow, authAt?: number): string {
  return app.jwt.sign(
    { sub: user.id, tv: user.token_version, auth_at: authAt ?? Math.floor(Date.now() / 1000) },
    { expiresIn: config.jwtExpiresIn },
  );
}
