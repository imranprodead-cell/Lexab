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

export interface Subscription {
  plan: string;
  status: 'active' | 'past_due' | 'canceled';
  renewsAt: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
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

  /** Current subscription state (plan, status, renewal, scheduled cancel). */
  async subscription(signal?: AbortSignal): Promise<Subscription> {
    if (USE_MOCK) {
      await delay(40);
      return { plan: 'Pro', status: 'active', renewsAt: null, periodEnd: null, cancelAtPeriodEnd: false };
    }
    return http<Subscription>('/billing/subscription', { signal });
  },

  /** Buy / renew a plan (activates immediately until the PSP fronts it).
   *  `consent` is the required waiver of the 14-day withdrawal right. */
  async checkout(plan: string, period: BillingPeriod, consent: boolean): Promise<PurchaseResult> {
    if (USE_MOCK) {
      await delay(300);
      return { ok: true, plan, period, discountPercent: period === 'yearly' ? 15 : 0, renewsAt: null };
    }
    return http<PurchaseResult>('/billing/checkout', { method: 'POST', body: { plan, period, consent } });
  },

  /** Cancel at period end — access stays until the period expires. */
  async cancel(): Promise<{ ok: boolean; cancelAtPeriodEnd: boolean; periodEnd: string | null }> {
    if (USE_MOCK) {
      await delay(200);
      return { ok: true, cancelAtPeriodEnd: true, periodEnd: null };
    }
    return http('/billing/cancel', { method: 'POST', body: {} });
  },

  /** Undo a scheduled cancellation. */
  async revertCancel(): Promise<{ ok: boolean; cancelAtPeriodEnd: boolean }> {
    if (USE_MOCK) {
      await delay(200);
      return { ok: true, cancelAtPeriodEnd: false };
    }
    return http('/billing/cancel/revert', { method: 'POST', body: {} });
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
