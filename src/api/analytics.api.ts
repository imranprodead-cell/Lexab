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

  /** Понедельничная сводка на почту: текущее состояние тумблера. */
  async digest(signal?: AbortSignal): Promise<{ enabled: boolean }> {
    if (USE_MOCK) {
      await delay(30);
      return { enabled: true };
    }
    return http<{ enabled: boolean }>('/me/digest', { signal });
  },

  async setDigest(enabled: boolean): Promise<{ enabled: boolean }> {
    if (USE_MOCK) {
      await delay(120);
      return { enabled };
    }
    return http<{ enabled: boolean }>('/me/digest', { method: 'POST', body: { enabled } });
  },

  /** Приём договоров по email: адрес-витрина (null = не настроен, карточка скрыта). */
  async intake(signal?: AbortSignal): Promise<{ enabled: boolean; address: string | null }> {
    if (USE_MOCK) {
      await delay(30);
      return { enabled: true, address: 'intake@lexab.app' };
    }
    return http<{ enabled: boolean; address: string | null }>('/me/intake', { signal });
  },
};
