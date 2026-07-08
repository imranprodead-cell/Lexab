/** Billing API — subscription plan + monthly usage vs limits. */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export interface UsageMetric {
  used: number;
  /** null = unlimited on this plan. */
  limit: number | null;
}

export interface PlanLimits {
  plan: string;
  aiRequests: UsageMetric;
  documents: UsageMetric;
  storageMb: UsageMetric;
}

export const billingApi = {
  async limits(signal?: AbortSignal): Promise<PlanLimits> {
    if (USE_MOCK) {
      await delay(40);
      return {
        plan: 'Pro',
        aiRequests: { used: 37, limit: null },
        documents: { used: 7, limit: 80 },
        storageMb: { used: 840, limit: 50 * 1024 },
      };
    }
    return http<PlanLimits>('/billing/limits', { signal });
  },
};
