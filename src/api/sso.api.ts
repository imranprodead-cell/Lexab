/** Team SSO admin API (Business feature; team owner only). */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export interface SsoConfig {
  configured: boolean;
  redirectUri: string;
  issuerUrl?: string;
  clientId?: string;
  secretSet?: boolean;
  emailDomain?: string;
  defaultRole?: 'admin' | 'editor' | 'viewer';
  enabled?: boolean;
  enforceSso?: boolean;
  domainVerified?: boolean;
  dnsRecord?: string;
}

export interface SsoSaveInput {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string; // omit to keep the stored one
  emailDomain: string;
  defaultRole: 'admin' | 'editor' | 'viewer';
}

export const ssoApi = {
  async get(signal?: AbortSignal): Promise<SsoConfig> {
    if (USE_MOCK) {
      await delay(40);
      return { configured: false, redirectUri: 'http://localhost:8080/api/auth/sso/callback' };
    }
    return http<SsoConfig>('/team/sso', { signal });
  },

  async save(input: SsoSaveInput): Promise<{ ok: boolean; redirectUri: string; dnsRecord: string; domainVerified: boolean }> {
    return http('/team/sso', { method: 'PUT', body: input });
  },

  async verifyDomain(): Promise<{ verified: boolean; dnsRecord?: string }> {
    return http('/team/sso/verify-domain', { method: 'POST', body: {} });
  },

  async toggle(patch: { enabled?: boolean; enforceSso?: boolean }): Promise<{ ok: boolean; enabled: boolean; enforceSso: boolean }> {
    return http('/team/sso', { method: 'PATCH', body: patch });
  },

  async remove(): Promise<void> {
    await http('/team/sso', { method: 'DELETE' });
  },
};
