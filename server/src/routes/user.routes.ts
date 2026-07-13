/** GET /me | PATCH /me */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { asObject, optionalString } from '../lib/validate.ts';
import { getUserById, toProfile, type UserRow } from '../plugins/auth.ts';
import { sendVerificationMail } from './auth.routes.ts';
import { resolveTeamName } from './team.routes.ts';

export function userRoutes(app: FastifyInstance, db: Db): void {
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => ({
    ...toProfile(req.currentUser),
    teamName: await resolveTeamName(db, req.currentUser.id),
  }));

  app.patch('/me', { preHandler: [app.authenticate] }, async (req) => {
    const body = asObject(req.body);
    const patch: Record<string, string | null | boolean> = {};
    let emailChangedTo: string | null = null;

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
      const lower = email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) throw badRequest('Invalid email address');
      if (lower !== req.currentUser.email.toLowerCase()) {
        // Clean 409 instead of a raw UNIQUE-violation 500 on a taken address.
        const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [lower, req.currentUser.id]);
        if (taken.rows.length) throw new HttpError(409, 'Этот email уже занят / This email is already in use');
        patch.email = lower;
        // A new address is UNPROVEN until re-confirmed — otherwise a user could
        // set their email to an address they don't own and keep "verified"
        // (which gates team-invite acceptance).
        patch.email_verified = false;
        emailChangedTo = lower;
      }
    }
    const initials = optionalString(body, 'initials');
    if (initials !== undefined) patch.initials = initials;
    const avatarUrl = optionalString(body, 'avatarUrl');
    if (avatarUrl !== undefined) patch.avatar_url = avatarUrl === '' ? null : avatarUrl; // '' clears the photo

    // Keep initials in sync when the name changes and no explicit override came in.
    if (typeof patch.name === 'string' && initials === undefined) {
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
    // Send the confirmation letter to the NEW address after the row is updated.
    if (emailChangedTo) {
      const displayName = typeof patch.name === 'string' ? patch.name : req.currentUser.name;
      await sendVerificationMail(db, req.currentUser.id, emailChangedTo, displayName);
    }
    const user = (await getUserById(db, req.currentUser.id)) as UserRow;
    return { ...toProfile(user), teamName: await resolveTeamName(db, req.currentUser.id) };
  });
}
