/** Cloud-storage integrations: Google Drive / Microsoft 365 / Dropbox. */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export type CloudProvider = 'google-drive' | 'microsoft' | 'dropbox';

export interface IntegrationStatus {
  provider: CloudProvider;
  label: string;
  /** False until the app keys are configured on the server. */
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
}

export interface CloudFile {
  id: string;
  name: string;
  size: number | null;
  modifiedAt: string | null;
}

export interface CloudImportResult {
  id: string;
  fileName: string;
  fileSize: string;
  url: string;
}

export const integrationsApi = {
  async list(signal?: AbortSignal): Promise<IntegrationStatus[]> {
    if (USE_MOCK) {
      await delay(40);
      return [
        { provider: 'google-drive', label: 'Google Drive', configured: false, connected: false, accountEmail: null },
        { provider: 'microsoft', label: 'Microsoft 365', configured: false, connected: false, accountEmail: null },
        { provider: 'dropbox', label: 'Dropbox', configured: false, connected: false, accountEmail: null },
      ];
    }
    return http<IntegrationStatus[]>('/integrations', { signal });
  },

  /** OAuth consent URL — open it in the current window. */
  connectUrl(provider: CloudProvider): Promise<{ url: string }> {
    return http<{ url: string }>(`/integrations/${provider}/connect`);
  },

  async disconnect(provider: CloudProvider): Promise<void> {
    await http<void>(`/integrations/${provider}`, { method: 'DELETE' });
  },

  /** Finish the OAuth flow: turn the callback's one-time grant into a live connection. */
  async claim(claimId: string): Promise<void> {
    await http<void>('/integrations/claim', { method: 'POST', body: { claimId } });
  },

  /** Google Picker bootstrap: access token (+ optional API key / app id). */
  pickerToken(): Promise<{ accessToken: string; appId: string; apiKey: string }> {
    return http<{ accessToken: string; appId: string; apiKey: string }>('/integrations/google-drive/picker-token');
  },

  files(provider: CloudProvider, search: string, signal?: AbortSignal): Promise<CloudFile[]> {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return http<CloudFile[]>(`/integrations/${provider}/files${qs}`, { signal });
  },

  /** Pull the file to LexAI — it lands as a normal upload, ready for analysis. */
  importFile(provider: CloudProvider, fileId: string, name: string): Promise<CloudImportResult> {
    return http<CloudImportResult>(`/integrations/${provider}/import`, { method: 'POST', body: { fileId, name } });
  },
};
