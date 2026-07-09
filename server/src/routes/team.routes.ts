/**
 * Team & invitations.
 *
 *   GET    /team/members                 — the current user's team (incl. pending invites)
 *   POST   /team/invite { email, role, title? } — invite by email; emails a join link;
 *                                          the person becomes a member ONLY after accepting
 *   PATCH  /team/members/:id { role }    — owner changes a member's role
 *   DELETE /team/members/:id             — owner removes a member / revokes an invite
 *   GET    /team/invite-info/:token      — PUBLIC: who invites whom (login banner)
 *   GET    /team/invitations             — invitations addressed to me (pending)
 *   POST   /team/invitations/:id/accept  — join the team (status → active)
 *   POST   /team/invitations/:id/decline — refuse (the row is removed — not added)
 *   POST   /team/invitations/accept-by-token { token } — accept from the bell
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { asObject, optionalString, requireEmail, requireString } from '../lib/validate.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import type { Member } from '../types.ts';

const ASSIGNABLE_ROLES = ['admin', 'editor', 'viewer'];
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
  title_label?: string | null;
  invite_token?: string | null;
}

function toMember(row: MemberRow, ownerView = true): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleKey: `team.role.${row.role}`,
    statusKey: `team.status.${row.status}`,
    color: row.color,
    title: row.title_label ?? null,
    manageable: ownerView,
    // Join links are the owner's business only.
    ...(ownerView && row.invite_token && row.status === 'invited' ? { inviteToken: row.invite_token } : {}),
  };
}

/** The invite is resolved — the bell's «Принять» button must go dead. */
async function retireInviteNotifications(db: Db, inviteToken: string | null): Promise<void> {
  if (!inviteToken) return;
  await db.query(
    `UPDATE notifications SET action_kind = NULL, action_data = NULL, read = true
     WHERE action_kind = 'team_invite' AND action_data = $1`,
    [inviteToken],
  );
}

/** Shared accept logic: by invitation id or by invite token (from the bell). */
async function acceptInvitation(
  db: Db,
  user: { id: string; email: string; name: string; email_verified?: boolean },
  where: { id?: string; token?: string },
): Promise<void> {
  if (!user.email_verified) {
    throw new HttpError(403, 'Подтвердите почту, чтобы принять приглашение / Verify your email to accept the invitation');
  }
  const byToken = Boolean(where.token);
  const res = await db.query<{ owner_user_id: string; invite_token: string | null }>(
    `UPDATE team_members SET status = 'active', name = $3, member_user_id = $4
     WHERE ${byToken ? 'invite_token = $1' : 'id = $1'} AND lower(email) = lower($2) AND status = 'invited'
     RETURNING owner_user_id, invite_token`,
    [byToken ? where.token : where.id, user.email, user.name, user.id],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Приглашение не найдено или уже принято / Invitation not found or already accepted');
  await retireInviteNotifications(db, row.invite_token);
  await notify(db, row.owner_user_id, 'check', 'Приглашение принято', 'Invitation accepted', {
    bodyRu: `${user.name} теперь в вашей команде`,
    bodyEn: `${user.name} joined your team`,
    action: { kind: 'open', data: '/team' },
  });
}

export function teamRoutes(app: FastifyInstance, db: Db): void {
  // The full roster: my own team when I have one, otherwise the team I've
  // joined — always with the owner (пригласитель) as the first row.
  app.get('/team/members', { preHandler: [app.authenticate] }, async (req): Promise<Member[]> => {
    const uid = req.currentUser.id;
    let ownerId = uid;
    let iAmOwner = true;
    let rows = (
      await db.query<MemberRow>(
        'SELECT id, name, email, role, status, color, title_label, invite_token FROM team_members WHERE owner_user_id = $1 ORDER BY created_at',
        [uid],
      )
    ).rows;

    if (rows.length === 0) {
      // Not an owner — am I an active member of someone's team?
      const membership = await db.query<{ owner_user_id: string }>(
        `SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`,
        [uid],
      );
      if (!membership.rows[0]) return [];
      ownerId = membership.rows[0].owner_user_id;
      iAmOwner = false;
      rows = (
        await db.query<MemberRow>(
          'SELECT id, name, email, role, status, color, title_label, invite_token FROM team_members WHERE owner_user_id = $1 ORDER BY created_at',
          [ownerId],
        )
      ).rows;
    }

    const owner = await db.query<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = $1', [ownerId]);
    const ownerRow: Member = {
      id: `owner_${ownerId}`,
      name: owner.rows[0]?.name ?? '—',
      email: owner.rows[0]?.email ?? '',
      roleKey: 'team.role.owner',
      statusKey: 'team.status.active',
      color: ROLE_COLORS.owner,
      title: null,
      manageable: false,
    };
    return [ownerRow, ...rows.map((r) => toMember(r, iAmOwner))];
  });

  app.post('/team/invite', { preHandler: [app.authenticate] }, async (req, reply): Promise<Member> => {
    await assertFeature(db, req.currentUser.id, 'team');
    // Business plan promises "up to 5 users" — count existing + pending.
    const size = await db.query<{ count: string | number }>(
      'SELECT count(*) AS count FROM team_members WHERE owner_user_id = $1',
      [req.currentUser.id],
    );
    if (Number(size.rows[0]?.count ?? 0) >= 5) {
      throw new HttpError(402, 'Лимит команды — 5 участников (план Business). Удалите кого-то или свяжитесь с нами для Enterprise.');
    }
    const body = asObject(req.body);
    const email = requireEmail(body);
    const role = requireString(body, 'role', { min: 1, max: 30 }).toLowerCase();
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw badRequest(`Field "role" must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    }
    const title = optionalString(body, 'title')?.slice(0, 60) || null;
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
    const token = crypto.randomBytes(24).toString('base64url');
    const color = ROLE_COLORS[role] ?? 'var(--mut)';
    await db.query(
      `INSERT INTO team_members (id, owner_user_id, name, email, role, status, color, title_label, invite_token)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7, $8)`,
      [id, req.currentUser.id, name || email, email, role, color, title, token],
    );

    // If the invitee already has an account, ping them in-app with an
    // Accept button right in the bell (mirrors the email).
    const invitee = await getUserByEmail(db, email);
    if (invitee) {
      await notify(db, invitee.id, 'docs', 'Приглашение в команду', 'Team invitation', {
        bodyRu: `${req.currentUser.name} (${req.currentUser.firm})${title ? ` · должность: ${title}` : ''}`,
        bodyEn: `${req.currentUser.name} (${req.currentUser.firm})${title ? ` · title: ${title}` : ''}`,
        action: { kind: 'team_invite', data: token },
      });
    }

    // Email with a join link (logs to console until RESEND_API_KEY is set).
    const inviteUrl = `${config.appBaseUrl}/login?invite=${token}`;
    const safeName = escapeMailHtml(req.currentUser.name);
    const safeFirm = escapeMailHtml(req.currentUser.firm);
    void sendMail({
      to: email,
      subject: `${req.currentUser.name} приглашает вас в команду LexAI`,
      html: mailLayout(
        'Приглашение в команду LexAI',
        `<p><strong>${safeName}</strong> (${safeFirm}) приглашает вас в свою команду в LexAI${title ? ` — должность «<strong>${escapeMailHtml(title)}</strong>»` : ''}.</p>
         <p>Откройте ссылку и войдите (или зарегистрируйтесь) с почтой <strong>${escapeMailHtml(email)}</strong> — приглашение будет ждать вас в разделе «Команда».</p>`,
        'Принять приглашение',
        inviteUrl,
      ),
    });

    reply.code(201);
    return toMember({ id, name: name || email, email, role, status: 'invited', color, title_label: title, invite_token: token });
  });

  // Owner changes a member's role.
  app.patch('/team/members/:id', { preHandler: [app.authenticate] }, async (req): Promise<Member> => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const role = requireString(body, 'role', { min: 1, max: 30 }).toLowerCase();
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw badRequest(`Field "role" must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    }
    const res = await db.query<MemberRow>(
      `UPDATE team_members SET role = $3, color = $4 WHERE id = $1 AND owner_user_id = $2
       RETURNING id, name, email, role, status, color, title_label, invite_token`,
      [id, req.currentUser.id, role, ROLE_COLORS[role] ?? 'var(--mut)'],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Участник не найден');
    return toMember(row);
  });

  // Owner removes a member (or revokes a pending invitation).
  app.delete('/team/members/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ member_user_id: string | null; status: string; name: string; invite_token: string | null }>(
      'DELETE FROM team_members WHERE id = $1 AND owner_user_id = $2 RETURNING member_user_id, status, name, invite_token',
      [id, req.currentUser.id],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Участник не найден / Member not found');
    await retireInviteNotifications(db, row.invite_token);
    if (row.member_user_id && row.status === 'active') {
      await notify(db, row.member_user_id, 'alert', 'Вы исключены из команды', 'Removed from the team', {
        bodyRu: `Команда: ${req.currentUser.name} (${req.currentUser.firm})`,
        bodyEn: `Team of ${req.currentUser.name} (${req.currentUser.firm})`,
      });
    }
    reply.code(204);
  });

  // PUBLIC: invite details for the login-page banner (no auth).
  app.get('/team/invite-info/:token', async (req) => {
    const { token } = req.params as { token: string };
    const res = await db.query<{ email: string; role: string; title_label: string | null; inviter_name: string; inviter_firm: string }>(
      `SELECT tm.email, tm.role, tm.title_label, u.name AS inviter_name, u.firm AS inviter_firm
       FROM team_members tm JOIN users u ON u.id = tm.owner_user_id
       WHERE tm.invite_token = $1 AND tm.status = 'invited'`,
      [token],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Приглашение не найдено или уже принято');
    return { email: row.email, role: row.role, title: row.title_label, inviterName: row.inviter_name, inviterFirm: row.inviter_firm };
  });

  // Invitations addressed to the current user's email.
  app.get('/team/invitations', { preHandler: [app.authenticate] }, async (req) => {
    if (!req.currentUser.email_verified) return []; // prove the mailbox first
    const res = await db.query<{ id: string; role: string; title_label: string | null; inviter_name: string; inviter_firm: string }>(
      `SELECT tm.id, tm.role, tm.title_label, u.name AS inviter_name, u.firm AS inviter_firm
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
      title: r.title_label,
    }));
  });

  app.post('/team/invitations/:id/accept', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await acceptInvitation(db, req.currentUser, { id });
    reply.code(204);
  });

  // Accept straight from the notification bell (the notification carries the token).
  app.post('/team/invitations/accept-by-token', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = asObject(req.body);
    const token = requireString(body, 'token', { min: 8, max: 100 });
    await acceptInvitation(db, req.currentUser, { token });
    reply.code(204);
  });

  app.post('/team/invitations/:id/decline', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ owner_user_id: string; invite_token: string | null }>(
      `DELETE FROM team_members
       WHERE id = $1 AND lower(email) = lower($2) AND status = 'invited'
       RETURNING owner_user_id, invite_token`,
      [id, req.currentUser.email],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Приглашение не найдено / Invitation not found');
    await retireInviteNotifications(db, row.invite_token);
    await notify(db, row.owner_user_id, 'alert', 'Приглашение отклонено', 'Invitation declined', {
      bodyRu: `${req.currentUser.name} не присоединится к команде`,
      bodyEn: `${req.currentUser.name} will not join the team`,
      action: { kind: 'open', data: '/team' },
    });
    reply.code(204);
  });
}
