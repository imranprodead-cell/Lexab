/** Notifications API — server-side event feed (analysis ready, e-sign, team). */
import { http } from './client';

export interface WireNotification {
  id: string;
  icon: 'esign' | 'check' | 'alert' | 'docs';
  title: string;
  titleEn?: string | null;
  /** Dim detail line under the title (file name, sender, …). */
  body?: string | null;
  bodyEn?: string | null;
  /** 'team_invite' (data = invite token) or 'open' (data = app path). */
  actionKind?: string;
  actionData?: string;
  time: string;
  createdAt?: string;
  read: boolean;
}

export const notificationsApi = {
  list(signal?: AbortSignal): Promise<WireNotification[]> {
    return http<WireNotification[]>('/notifications', { signal });
  },

  /** Mark one notification read, or all of them when `id` is omitted. */
  async markRead(id?: string): Promise<void> {
    await http<void>('/notifications/read', { method: 'POST', body: id ? { id } : {} });
  },
};
