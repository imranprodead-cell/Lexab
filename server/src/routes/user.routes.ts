/** GET /me | PATCH /me */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest } from '../lib/errors.ts';
import { asObject, optionalString } from '../lib/validate.ts';
import { getUserById, toProfile, type UserRow } from '../plugins/auth.ts';

export function userRoutes(app: FastifyInstance, db: Db): void {
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => toProfile(req.currentUser));

  app.patch('/me', { preHandler: [app.authenticate] }, async (req) => {
    const body = asObject(req.body);
    const patch: Record<string, string | null> = {};

    const name = optionalString(body, 'name');
    if (name !== undefined) {
      if (!name.trim()) throw badRequest('Name cannot be empty');
      patch.name = name.trim();
    }
    const firm = optionalString(body, 'firm');
    if (firm !== undefined) patch.firm = firm;
    const jurisdiction = optionalString(body, 'jurisdiction');
    if (jurisdiction !== undefined) patch.jurisdiction = jurisdiction;
    const email = optionalString(body, 'email');
    if (email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Invalid email address');
      patch.email = email.toLowerCase();
    }
    const initials = optionalString(body, 'initials');
    if (initials !== undefined) patch.initials = initials;
    const avatarUrl = optionalString(body, 'avatarUrl');
    if (avatarUrl !== undefined) patch.avatar_url = avatarUrl === '' ? null : avatarUrl; // '' clears the photo

    // Keep initials in sync when the name changes and no explicit override came in.
    if (patch.name && initials === undefined) {
      const parts = patch.name.split(/\s+/).filter(Boolean);
      patch.initials =
        parts.length === 1
          ? parts[0].slice(0, 2).toUpperCase()
          : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    const keys = Object.keys(patch);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await db.query(`UPDATE users SET ${sets} WHERE id = $1`, [req.currentUser.id, ...keys.map((k) => patch[k])]);
    }
    const user = (await getUserById(db, req.currentUser.id)) as UserRow;
    return toProfile(user);
  });
}
