/** Audit Log API — the team owner's event trail (Business feature). */
import { USE_MOCK, http, httpBlob } from './client';
import { delay } from './util';

export interface AuditEvent {
  id: string;
  actor: string | null;
  type: string;
  targetType: string | null;
  target: string | null;
  status: 'ok' | 'error' | 'denied';
  ip: string | null;
  at: string;
}

export interface AuditFilter {
  group?: string;
  actorId?: string;
  from?: string;
  to?: string;
  /** Free-text search: actor, event type or target name. */
  q?: string;
  page?: number;
  pageSize?: number;
}

function toQuery(f: AuditFilter): string {
  const p = new URLSearchParams();
  if (f.group) p.set('group', f.group);
  if (f.actorId) p.set('actorId', f.actorId);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.q) p.set('q', f.q);
  if (f.page) p.set('page', String(f.page));
  if (f.pageSize) p.set('pageSize', String(f.pageSize));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const auditApi = {
  /** List events (returns rows; total count is in the X-Total-Count header,
   *  read via a lightweight wrapper below when needed). */
  async list(filter: AuditFilter = {}, signal?: AbortSignal): Promise<AuditEvent[]> {
    if (USE_MOCK) {
      await delay(60);
      return [];
    }
    return http<AuditEvent[]>(`/audit/events${toQuery(filter)}`, { signal });
  },

  /** CSV export of the current filter → triggers a browser download. */
  async downloadCsv(filter: AuditFilter = {}): Promise<Blob> {
    if (USE_MOCK) {
      await delay(60);
      return new Blob(['time,actor,event,target,status,ip\n'], { type: 'text/csv' });
    }
    return httpBlob(`/audit/events.csv${toQuery(filter)}`);
  },
};
