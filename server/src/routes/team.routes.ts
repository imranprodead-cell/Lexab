/**
 * Team & invitations.
 *
 *   GET  /team/members                 — the current user's team (incl. pending invites)
 *   POST /team/invite { email, role }  — invite by email; the person becomes a
 *                                        member ONLY after accepting in the app
 *   GET  /team/invitations             — invitations addressed to me (pending)
 *   POST /team/invitations/:id/accept  — join the team (status → active)
 *   POST /team/invitations/:id/decline — refuse (the row is removed — not added)
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { asObject, requireEmail, requireString } from '../lib/validate.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import type { Member } from '../types.ts';

const ROLES = ['owner', 'admin', 'editor', 'viewer'];
const ROLE_COLORS: Record<string, string> = {
  owner: 'var(--accent)',
  admin: 'var(--sev-low)',
  editor: 'var(--sev-med)',
  viewer: 'var(--mut)',
};

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  color: string;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleKey: `team.role.${row.role}`,
    statusKey: `team.status.${row.status}`,
    color: row.color,
  };
}

export function teamRoutes(app: FastifyInstance, db: Db): void {
  app.get('/team/members', { preHandler: [app.authenticate] }, async (req): Promise<Member[]> => {
    const res = await db.query<MemberRow>(
      'SELECT id, name, email, role, status, color FROM team_members WHERE owner_user_id = $1 ORDER BY created_at',
      [req.currentUser.id],
    );
    return res.rows.map(toMember);
  });

  app.post('/team/invite', { preHandler: [app.authenticate] }, async (req, reply): Promise<Member> => {
    const body = asObject(req.body);
    const email = requireEmail(body);
    const role = requireString(body, 'role', { min: 1, max: 30 }).toLowerCase();
    if (!ROLES.includes(role)) throw badRequest(`Field "role" must be one of: ${ROLES.join(', ')}`);
    if (email === req.currentUser.email.toLowerCase()) {
      throw badRequest('Нельзя пригласить самого себя');
    }
    const dup = await db.query('SELECT 1 FROM team_members WHERE owner_user_id = $1 AND lower(email) = $2', [
      req.currentUser.id,
      email,
    ]);
    if (dup.rows[0]) throw new HttpError(409, 'Этот пользователь уже приглашён или состоит в команде');

    const localPart = email.split('@')[0];
    const name = localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join(' ');

    const id = newId('tm');
    const color = ROLE_COLORS[role] ?? 'var(--mut)';
    await db.query(
      `INSERT INTO team_members (id, owner_user_id, name, email, role, status, color)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6)`,
      [id, req.currentUser.id, name || email, email, role, color],
    );

    // If the invitee already has an account, ping them in-app.
    const invitee = await getUserByEmail(db, email);
    if (invitee) {
      await db.query(`INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'docs', $3)`, [
        newId('n'),
        invitee.id,
        `${req.currentUser.name} приглашает вас в команду — откройте раздел «Команда»`,
      ]);
    }

    reply.code(201);
    return toMember({ id, name: name || email, email, role, status: 'invited', color });
  });

  // Invitations addressed to the current user's email.
  app.get('/team/invitations', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ id: string; role: string; inviter_name: string; inviter_firm: string }>(
      `SELECT tm.id, tm.role, u.name AS inviter_name, u.firm AS inviter_firm
       FROM team_members tm
       JOIN users u ON u.id = tm.owner_user_id
       WHERE lower(tm.email) = lower($1) AND tm.status = 'invited' AND tm.owner_user_id <> $2
       ORDER BY tm.created_at DESC`,
      [req.currentUser.email, req.currentUser.id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      inviterName: r.inviter_name,
      inviterFirm: r.inviter_firm,
      role: r.role,
      roleKey: `team.role.${r.role}`,
    }));
  });

  app.post('/team/invitations/:id/accept', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ owner_user_id: string }>(
      `UPDATE team_members SET status = 'active', name = $3
       WHERE id = $1 AND lower(email) = lower($2) AND status = 'invited'
       RETURNING owner_user_id`,
      [id, req.currentUser.email, req.currentUser.name],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Приглашение не найдено');
    await db.query(`INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'check', $3)`, [
      newId('n'),
      row.owner_user_id,
      `${req.currentUser.name} принял(а) приглашение в команду`,
    ]);
    reply.code(204);
  });

  app.post('/team/invitations/:id/decline', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ owner_user_id: string }>(
      `DELETE FROM team_members
       WHERE id = $1 AND lower(email) = lower($2) AND status = 'invited'
       RETURNING owner_user_id`,
      [id, req.currentUser.email],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Приглашение не найдено');
    await db.query(`INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'alert', $3)`, [
      newId('n'),
      row.owner_user_id,
      `${req.currentUser.name} отклонил(а) приглашение в команду`,
    ]);
    reply.code(204);
  });
}
