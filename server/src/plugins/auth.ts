/**
 * JWT auth. Every protected route uses the `authenticate` preHandler.
 *
 * Tokens carry { sub: userId, tv: tokenVersion }. Logout bumps the user's
 * token_version, invalidating all previously issued tokens.
 *
 * AUTH_MODE=demo (local development): a missing/invalid token resolves to the
 * seeded demo user, so the shipped frontend — whose auth store is still the
 * localStorage mock — works against the real backend without UI changes.
 * AUTH_MODE=required (production): a missing/invalid token is a 401.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DEMO_USER_ID, config } from '../config.ts';
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
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    currentUser: UserRow;
  }
}

export function toProfile(row: UserRow): UserProfile {
  return {
    name: row.name,
    initials: row.initials,
    firm: row.firm,
    jurisdiction: row.jurisdiction,
    email: row.email,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const res = await db.query<UserRow>(
    'SELECT id, email, name, initials, firm, jurisdiction, avatar_url, token_version FROM users WHERE id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function getUserByEmail(db: Db, email: string): Promise<(UserRow & { password_hash: string }) | null> {
  const res = await db.query<UserRow & { password_hash: string }>(
    'SELECT id, email, name, initials, firm, jurisdiction, avatar_url, token_version, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  return res.rows[0] ?? null;
}

export function registerAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('currentUser');

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (token) {
      try {
        const payload = app.jwt.verify<{ sub: string; tv: number }>(token);
        const user = await getUserById(db, payload.sub);
        if (user && user.token_version === payload.tv) {
          req.currentUser = user;
          return;
        }
      } catch {
        /* invalid/expired token — fall through */
      }
    }

    if (config.authMode === 'demo') {
      const demo = await getUserById(db, DEMO_USER_ID);
      if (demo) {
        req.currentUser = demo;
        return;
      }
    }
    throw unauthorized();
  });
}

export function signToken(app: FastifyInstance, user: UserRow): string {
  return app.jwt.sign({ sub: user.id, tv: user.token_version }, { expiresIn: config.jwtExpiresIn });
}
