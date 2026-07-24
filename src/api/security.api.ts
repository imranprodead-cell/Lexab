/**
 * Account-security API — TOTP two-factor, active sessions, GDPR data export
 * (self-service) and the team access review (owner/admin, Business feature).
 * All endpoints require auth; the access-review ones answer 402 below Business.
 */
import type { UserProfile } from '@/types/domain';
import { USE_MOCK, http, httpBlob } from './client';
import { downloadBlob } from '@/lib/download';
import { clone, delay } from './util';

export interface TwoFactorStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

/** Enrolment secret (before the first valid code confirms it). */
export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}

/** Result of enabling — the one-and-only reveal of the backup codes. */
export interface TwoFactorEnableResult {
  enabled: true;
  backupCodes: string[];
}

export interface SessionInfo {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface AccessReviewRow {
  name: string;
  email: string;
  role: string;
  status: string;
  lastActiveAt: string | null;
}

/** Fresh session handed back when other sessions are revoked (the call rotates
 *  the current token, so the caller must adopt the new one). */
export interface RotatedSession {
  token: string;
  user: UserProfile;
}

const mockSessions: SessionInfo[] = [
  {
    id: 's1',
    ip: '82.14.10.3',
    userAgent: 'Chrome 120 · macOS',
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  },
  {
    id: 's2',
    ip: '82.14.10.3',
    userAgent: 'Safari · iPhone',
    createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  },
];

const mockAccessReview: AccessReviewRow[] = [
  { name: 'A. Rahman', email: 'a.rahman@freshfields.com', role: 'team.role.owner', status: 'team.status.active', lastActiveAt: new Date(Date.now() - 20 * 60_000).toISOString() },
  { name: 'J. Okoro', email: 'j.okoro@freshfields.com', role: 'team.role.admin', status: 'team.status.active', lastActiveAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { name: 'M. Chen', email: 'm.chen@freshfields.com', role: 'team.role.viewer', status: 'team.status.invited', lastActiveAt: null },
];

export const securityApi = {
  twofa: {
    async status(signal?: AbortSignal): Promise<TwoFactorStatus> {
      if (USE_MOCK) {
        await delay(40);
        return { enabled: false, backupCodesRemaining: 0 };
      }
      return http<TwoFactorStatus>('/me/2fa', { signal });
    },

    async setup(): Promise<TwoFactorSetup> {
      if (USE_MOCK) {
        await delay(150);
        return { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Lexab:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Lexab' };
      }
      return http<TwoFactorSetup>('/me/2fa/setup', { method: 'POST' });
    },

    async enable(code: string): Promise<TwoFactorEnableResult> {
      if (USE_MOCK) {
        await delay(200);
        return { enabled: true, backupCodes: ['A1B2-C3D4', 'E5F6-G7H8', 'J9K0-L1M2', 'N3P4-Q5R6', 'S7T8-U9V0', 'W1X2-Y3Z4'] };
      }
      return http<TwoFactorEnableResult>('/me/2fa/enable', { method: 'POST', body: { code } });
    },

    async disable(password: string): Promise<{ enabled: false }> {
      if (USE_MOCK) {
        await delay(200);
        return { enabled: false };
      }
      return http<{ enabled: false }>('/me/2fa/disable', { method: 'POST', body: { password } });
    },
  },

  sessions: {
    async list(signal?: AbortSignal): Promise<SessionInfo[]> {
      if (USE_MOCK) {
        await delay(60);
        return clone(mockSessions);
      }
      return http<SessionInfo[]>('/me/sessions', { signal });
    },

    /** Rotates the current session and revokes the rest — returns a fresh token
     *  the caller MUST adopt, else it signs itself out. */
    async revokeOthers(): Promise<RotatedSession> {
      if (USE_MOCK) {
        await delay(200);
        const raw = localStorage.getItem('lexai.auth');
        const session = raw ? (JSON.parse(raw) as RotatedSession) : null;
        return { token: `mock_${Date.now()}`, user: session?.user ?? { name: 'You', initials: 'YO', firm: 'Lexab', jurisdiction: 'United Kingdom', email: 'you@example.com' } };
      }
      return http<RotatedSession>('/me/sessions/revoke-others', { method: 'POST' });
    },
  },

  /** DSAR: download the full account export as a JSON file. */
  async exportData(): Promise<void> {
    if (USE_MOCK) {
      await delay(200);
      downloadBlob(new Blob(['{"export":"demo"}'], { type: 'application/json' }), 'lexab-data-export.json');
      return;
    }
    const blob = await httpBlob('/me/export');
    downloadBlob(blob, 'lexab-data-export.json');
  },

  accessReview: {
    /** 402 below Business — the page surfaces an upsell. */
    async list(signal?: AbortSignal): Promise<AccessReviewRow[]> {
      if (USE_MOCK) {
        await delay(60);
        return clone(mockAccessReview);
      }
      return http<AccessReviewRow[]>('/team/access-review', { signal });
    },

    async downloadCsv(): Promise<Blob> {
      if (USE_MOCK) {
        await delay(60);
        return new Blob(['name,email,role,status,last_active\n'], { type: 'text/csv' });
      }
      return httpBlob('/team/access-review.csv');
    },
  },
};
