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

export type BillingPeriod = 'monthly' | 'yearly';

/** PRE-STRIPE: purchase activates the plan immediately and refreshes quotas. */
export interface PurchaseResult {
  ok: boolean;
  plan: string;
  period: BillingPeriod;
  discountPercent: number;
  renewsAt: string | null;
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

  /** Buy / renew a plan (activates immediately until Stripe fronts it). */
  async checkout(plan: string, period: BillingPeriod): Promise<PurchaseResult> {
    if (USE_MOCK) {
      await delay(300);
      return { ok: true, plan, period, discountPercent: period === 'yearly' ? 15 : 0, renewsAt: null };
    }
    return http<PurchaseResult>('/billing/checkout', { method: 'POST', body: { plan, period } });
  },

  /** Enterprise: send a contact-sales request to the LexAI team. */
  async contactSales(): Promise<void> {
    if (USE_MOCK) {
      await delay(300);
      return;
    }
    await http('/billing/contact-sales', { method: 'POST', body: {} });
  },
};
