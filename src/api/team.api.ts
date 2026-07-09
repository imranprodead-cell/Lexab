/** Team API — members list, invitations, accept/decline flow. */
import { USE_MOCK, http } from './client';
import { clone, delay } from './util';

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  statusKey: string;
  color: string;
  /** Human job title (Юрист, Директор, …) chosen when inviting. */
  title?: string | null;
  /** True when the current viewer (team owner) may remove this member. */
  manageable?: boolean;
  /** Pending invitations only: token for the join link. */
  inviteToken?: string;
}

/** An invitation addressed to the current user (pending acceptance). */
export interface TeamInvitation {
  id: string;
  inviterName: string;
  inviterFirm: string;
  role: TeamRole;
  roleKey: string;
  title?: string | null;
}

export const ROLE_COLORS: Record<TeamRole, string> = {
  owner: 'var(--accent)',
  admin: 'var(--sev-low)',
  editor: 'var(--sev-med)',
  viewer: 'var(--mut)',
};

const mockMembers: TeamMember[] = [
  { id: 'tm1', name: 'A. Rahman', email: 'a.rahman@freshfields.com', roleKey: 'team.role.owner', statusKey: 'team.status.active', color: 'var(--accent)' },
  { id: 'tm2', name: 'J. Okoro', email: 'j.okoro@freshfields.com', roleKey: 'team.role.admin', statusKey: 'team.status.active', color: 'var(--sev-low)' },
  { id: 'tm3', name: 'P. Nasser', email: 'p.nasser@freshfields.com', roleKey: 'team.role.editor', statusKey: 'team.status.active', color: 'var(--sev-med)' },
  { id: 'tm4', name: 'M. Chen', email: 'm.chen@freshfields.com', roleKey: 'team.role.viewer', statusKey: 'team.status.invited', color: 'var(--mut)' },
];

export const teamApi = {
  async members(signal?: AbortSignal): Promise<TeamMember[]> {
    if (USE_MOCK) {
      await delay(40);
      return clone(mockMembers);
    }
    return http<TeamMember[]>('/team/members', { signal });
  },

  async invitations(signal?: AbortSignal): Promise<TeamInvitation[]> {
    if (USE_MOCK) {
      await delay(40);
      return [];
    }
    return http<TeamInvitation[]>('/team/invitations', { signal });
  },

  async invite(email: string, role: TeamRole, title?: string): Promise<TeamMember> {
    if (USE_MOCK) {
      await delay(400);
      const member: TeamMember = {
        id: `tm_${Date.now()}`,
        name: email.split('@')[0],
        email,
        roleKey: `team.role.${role}`,
        statusKey: 'team.status.invited',
        color: ROLE_COLORS[role],
        title: title ?? null,
      };
      mockMembers.push(member);
      return clone(member);
    }
    return http<TeamMember>('/team/invite', { method: 'POST', body: { email, role, ...(title ? { title } : {}) } });
  },

  async accept(id: string): Promise<void> {
    if (USE_MOCK) return;
    await http<void>(`/team/invitations/${id}/accept`, { method: 'POST' });
  },

  /** Accept an invitation straight from the notification bell. */
  async acceptByToken(token: string): Promise<void> {
    if (USE_MOCK) return;
    await http<void>('/team/invitations/accept-by-token', { method: 'POST', body: { token } });
  },

  /** Owner/admin names the organisation — once, immutable afterwards. */
  setName(name: string): Promise<{ teamName: string }> {
    return http<{ teamName: string }>('/team/name', { method: 'POST', body: { name } });
  },

  async decline(id: string): Promise<void> {
    if (USE_MOCK) return;
    await http<void>(`/team/invitations/${id}/decline`, { method: 'POST' });
  },

  /** Owner: change a member's role. */
  async updateRole(id: string, role: Exclude<TeamRole, 'owner'>): Promise<TeamMember> {
    if (USE_MOCK) {
      await delay(150);
      const m = mockMembers.find((x) => x.id === id);
      if (m) {
        m.roleKey = `team.role.${role}`;
        m.color = ROLE_COLORS[role];
      }
      return clone(m as TeamMember);
    }
    return http<TeamMember>(`/team/members/${id}`, { method: 'PATCH', body: { role } });
  },

  /** Owner: remove a member or revoke a pending invitation. */
  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(150);
      const i = mockMembers.findIndex((x) => x.id === id);
      if (i >= 0) mockMembers.splice(i, 1);
      return;
    }
    await http<void>(`/team/members/${id}`, { method: 'DELETE' });
  },

  /** PUBLIC: invite details for the login-page banner. */
  async inviteInfo(token: string): Promise<{ email: string; role: string; inviterName: string; inviterFirm: string }> {
    return http(`/team/invite-info/${encodeURIComponent(token)}`);
  },
};
