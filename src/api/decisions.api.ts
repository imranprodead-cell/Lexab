/** Решения по находкам и отметки по продлению (ui-test 2026-11-15) — видны команде. */
import { USE_MOCK, http } from './client';
import { delay } from './util';
import type { FindingDecision } from '@/lib/findingDecisions';
import type { RenewalMark } from '@/lib/renewal';

const mockDecisions = new Map<string, Record<string, FindingDecision>>();

export const decisionsApi = {
  async list(analysisId: string, signal?: AbortSignal): Promise<Record<string, FindingDecision>> {
    if (USE_MOCK) {
      await delay(40);
      return { ...(mockDecisions.get(analysisId) ?? {}) };
    }
    return http<Record<string, FindingDecision>>(`/analysis/${encodeURIComponent(analysisId)}/decisions`, { signal });
  },

  async set(analysisId: string, findingId: string, d: Pick<FindingDecision, 'kind' | 'to' | 'note'>): Promise<FindingDecision> {
    if (USE_MOCK) {
      await delay(40);
      const saved: FindingDecision = { ...d, who: 'You', at: new Date().toISOString() };
      mockDecisions.set(analysisId, { ...(mockDecisions.get(analysisId) ?? {}), [findingId]: saved });
      return saved;
    }
    return http<FindingDecision>(`/analysis/${encodeURIComponent(analysisId)}/decisions/${encodeURIComponent(findingId)}`, {
      method: 'PUT',
      body: { kind: d.kind, to: d.to, note: d.note },
    });
  },

  async clear(analysisId: string, findingId: string): Promise<void> {
    if (USE_MOCK) {
      const rec = { ...(mockDecisions.get(analysisId) ?? {}) };
      delete rec[findingId];
      mockDecisions.set(analysisId, rec);
      return;
    }
    await http(`/analysis/${encodeURIComponent(analysisId)}/decisions/${encodeURIComponent(findingId)}`, { method: 'DELETE' });
  },

  async setRenewalMark(documentId: string, kind: RenewalMark['kind'], last: string): Promise<RenewalMark> {
    if (USE_MOCK) return { kind, last, who: 'You', at: new Date().toISOString() };
    return http<RenewalMark>(`/contracts/${encodeURIComponent(documentId)}/renewal-mark`, { method: 'PUT', body: { kind, last } });
  },

  async clearRenewalMark(documentId: string): Promise<void> {
    if (USE_MOCK) return;
    await http(`/contracts/${encodeURIComponent(documentId)}/renewal-mark`, { method: 'DELETE' });
  },
};
