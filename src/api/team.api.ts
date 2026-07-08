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
}

/** An invitation addressed to the current user (pending acceptance). */
export interface TeamInvitation {
  id: string;
  inviterName: string;
  inviterFirm: string;
  role: TeamRole;
  roleKey: string;
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

  async invite(email: string, role: TeamRole): Promise<TeamMember> {
    if (USE_MOCK) {
      await delay(400);
      const member: TeamMember = {
        id: `tm_${Date.now()}`,
        name: email.split('@')[0],
        email,
        roleKey: `team.role.${role}`,
        statusKey: 'team.status.invited',
        color: ROLE_COLORS[role],
      };
      mockMembers.push(member);
      return clone(member);
    }
    return http<TeamMember>('/team/invite', { method: 'POST', body: { email, role } });
  },

  async accept(id: string): Promise<void> {
    if (USE_MOCK) return;
    await http<void>(`/team/invitations/${id}/accept`, { method: 'POST' });
  },

  async decline(id: string): Promise<void> {
    if (USE_MOCK) return;
    await http<void>(`/team/invitations/${id}/decline`, { method: 'POST' });
  },
};
