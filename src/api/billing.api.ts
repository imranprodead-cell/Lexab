/** Billing API — subscription plan + monthly usage vs limits. */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export interface UsageMetric {
  used: number;
  /** null = unlimited on this plan. */
  limit: number | null;
}

/** Рантайм-флаги разделов, приходящие с сервера (см. useFeatureFlags). */
export interface FeatureFlags {
  /** Э-подписи закрыты до подключения E-IMZO — интерфейс показывает «скоро». */
  esign: boolean;
}

export interface PlanLimits {
  plan: string;
  aiRequests: UsageMetric;
  documents: UsageMetric;
  storageMb: UsageMetric;
  features?: FeatureFlags;
}

export type BillingPeriod = 'monthly' | 'yearly';

/** Результат checkout: либо url страницы оплаты Lemon Squeezy (новая покупка),
 *  либо changed=true (смена тарифа с проратой), либо мгновенная dev-активация. */
export interface PurchaseResult {
  ok: boolean;
  plan: string;
  period: BillingPeriod;
  discountPercent: number;
  renewsAt?: string | null;
  /** Hosted-checkout URL — фронт делает window.location.assign(url). */
  url?: string;
  /** Тариф изменён у провайдера немедленно (прорация LS). */
  changed?: boolean;
}

export interface Subscription {
  plan: string;
  period?: BillingPeriod | null;
  status: 'active' | 'past_due' | 'canceled';
  renewsAt: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** 'lemonsqueezy' — подписка живёт у провайдера (доступен портал оплаты). */
  provider?: 'lemonsqueezy' | null;
}

export const billingApi = {
  async limits(signal?: AbortSignal): Promise<PlanLimits> {
    if (USE_MOCK) {
      await delay(40);
      return {
        plan: 'Pro',
        aiRequests: { used: 37, limit: 500 },
        documents: { used: 7, limit: 80 },
        storageMb: { used: 840, limit: 50 * 1024 },
        features: { esign: false },
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

  /** Buy / change a plan. С настроенным Lemon Squeezy возвращает url оплаты
   *  (новая покупка) или changed=true (смена тарифа); в dev — активирует сразу.
   *  `consent` is the required waiver of the 14-day withdrawal right. */
  async checkout(plan: string, period: BillingPeriod, consent: boolean): Promise<PurchaseResult> {
    if (USE_MOCK) {
      await delay(300);
      return { ok: true, plan, period, discountPercent: period === 'yearly' ? 15 : 0, renewsAt: null };
    }
    return http<PurchaseResult>('/billing/checkout', { method: 'POST', body: { plan, period, consent } });
  },

  /** Подписанный короткоживущий URL Кабинета покупателя LS (карта, чеки). */
  async portal(): Promise<{ url: string }> {
    if (USE_MOCK) {
      await delay(150);
      return { url: 'https://example.lemonsqueezy.com/billing' };
    }
    return http<{ url: string }>('/billing/portal');
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

  /** Enterprise: send a contact-sales request to the Lexab team. */
  async contactSales(): Promise<void> {
    if (USE_MOCK) {
      await delay(300);
      return;
    }
    await http('/billing/contact-sales', { method: 'POST', body: {} });
  },
};
