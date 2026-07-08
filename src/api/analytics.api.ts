/** Analytics + workspace-support APIs (versions), plus the user profile. */
import type {
  AnalyticsSummary,
  DocumentVersion,
  UserProfile,
} from '@/types/domain';
import { USE_MOCK, http } from './client';
import { db } from './mock/db';
import { clone, delay } from './util';

export const analyticsApi = {
  async summary(signal?: AbortSignal): Promise<AnalyticsSummary> {
    if (USE_MOCK) {
      await delay(50);
      return clone(db.analytics);
    }
    return http<AnalyticsSummary>('/analytics/summary', { signal });
  },
};

export const versionsApi = {
  async list(_documentId: string, signal?: AbortSignal): Promise<DocumentVersion[]> {
    if (USE_MOCK) {
      await delay(40);
      return clone(db.versions);
    }
    return http<DocumentVersion[]>(`/documents/${_documentId}/versions`, { signal });
  },
};

export const userApi = {
  async me(signal?: AbortSignal): Promise<UserProfile> {
    if (USE_MOCK) {
      await delay(40);
      return clone(db.user);
    }
    return http<UserProfile>('/me', { signal });
  },

  async update(patch: Partial<UserProfile>): Promise<UserProfile> {
    if (USE_MOCK) {
      await delay(400);
      db.user = { ...db.user, ...patch };
      return clone(db.user);
    }
    return http<UserProfile>('/me', { method: 'PATCH', body: patch });
  },
};
