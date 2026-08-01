/**
 * Lemon Squeezy — платёжный провайдер подписок (Merchant of Record: сам
 * собирает мировые налоги, выставляет чеки, несёт chargeback-риск).
 *
 * Raw fetch без SDK (стиль esign.ts): поверхность — пять вызовов JSON:API.
 * Включается только полным конфигом (config.lemonSqueezy.enabled); все
 * event-обработчики живут в billing.routes.ts, здесь — чистый транспорт.
 */
import crypto from 'node:crypto';
import { config } from '../config.ts';

const API_BASE = 'https://api.lemonsqueezy.com/v1';

export function lemonSqueezyEnabled(): boolean {
  return config.lemonSqueezy.enabled;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.lemonSqueezy.apiKey}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
}

async function lsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lemon Squeezy ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** Атрибуты подписки LS, которые мы потребляем (подмножество API). */
export interface LsSubscriptionAttributes {
  store_id: number | string;
  customer_id: number | string;
  variant_id: number | string;
  status: string; // on_trial | active | past_due | unpaid | cancelled | expired | paused
  renews_at: string | null;
  ends_at: string | null;
  updated_at: string;
  test_mode?: boolean;
  urls?: { customer_portal?: string; update_payment_method?: string };
}

export interface LsSubscription {
  id: string;
  attributes: LsSubscriptionAttributes;
}

interface LsSubscriptionResponse {
  data: { id: string; attributes: LsSubscriptionAttributes };
}

/** Создать hosted-checkout; возвращает URL страницы оплаты. */
export async function createCheckout(opts: {
  variantId: string;
  userId: string;
  email: string;
  name: string;
  redirectUrl: string;
}): Promise<string> {
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: opts.email,
          name: opts.name,
          // Вернётся в каждом вебхуке как meta.custom_data.user_id — единственная
          // надёжная связь «оплата → наш пользователь».
          custom: { user_id: opts.userId },
        },
        product_options: { redirect_url: opts.redirectUrl },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(config.lemonSqueezy.storeId) } },
        variant: { data: { type: 'variants', id: String(opts.variantId) } },
      },
    },
  };
  const res = await lsFetch<{ data: { attributes: { url: string } } }>('/checkouts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data.attributes.url;
}

export async function getSubscription(id: string): Promise<LsSubscription> {
  const res = await lsFetch<LsSubscriptionResponse>(`/subscriptions/${encodeURIComponent(id)}`);
  return { id: res.data.id, attributes: res.data.attributes };
}

/** Смена тарифа/периода: PATCH variant с прорацией. invoice_immediately —
 *  доплата списывается СРАЗУ: иначе апгрейд Standard→Business выдаёт дорогой
 *  план мгновенно, а прорированная разница уезжает в следующий инвойс, который
 *  можно не заплатить, отменившись (месяц Business по цене Standard). */
export async function changeSubscriptionVariant(id: string, variantId: string): Promise<LsSubscription> {
  const body = {
    data: { type: 'subscriptions', id: String(id), attributes: { variant_id: Number(variantId), invoice_immediately: true } },
  };
  const res = await lsFetch<LsSubscriptionResponse>(`/subscriptions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return { id: res.data.id, attributes: res.data.attributes };
}

/** Отмена в конце периода (LS: status=cancelled + ends_at; доступ до конца). */
export async function cancelSubscription(id: string): Promise<LsSubscription> {
  const res = await lsFetch<LsSubscriptionResponse>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { id: res.data.id, attributes: res.data.attributes };
}

/** Возобновление отменённой (но ещё не истёкшей) подписки. */
export async function resumeSubscription(id: string): Promise<LsSubscription> {
  const body = { data: { type: 'subscriptions', id: String(id), attributes: { cancelled: false } } };
  const res = await lsFetch<LsSubscriptionResponse>(`/subscriptions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return { id: res.data.id, attributes: res.data.attributes };
}

/** variant_id → {plan, period}; null для неизвестного варианта (misconfig). */
export function variantToPlan(variantId: string | number): { plan: string; period: 'monthly' | 'yearly' } | null {
  const id = String(variantId);
  for (const [plan, v] of Object.entries(config.lemonSqueezy.variants)) {
    if (String(v.monthly) === id) return { plan, period: 'monthly' };
    if (String(v.yearly) === id) return { plan, period: 'yearly' };
  }
  return null;
}

export function variantFor(plan: string, period: 'monthly' | 'yearly'): string | null {
  const v = config.lemonSqueezy.variants[plan];
  return v ? v[period] || null : null;
}

/**
 * Подпись вебхука: X-Signature = HMAC-SHA256(hex) от СЫРОГО тела с секретом
 * вебхука. Сравнение — timingSafeEqual (образец: esign.ts verifyWebhook).
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!config.lemonSqueezy.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.lemonSqueezy.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
