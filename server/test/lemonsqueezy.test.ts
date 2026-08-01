/**
 * Lemon Squeezy: checkout-роут и вебхук против PGlite + мок LS API
 * (monkey-patch globalThis.fetch по образцу tts-сьюта в routes.test.ts).
 * Отдельный процесс node:test — свой env: полный LS-конфиг, БЕЗ BILLING_FALLBACK.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Env ДО динамических импортов (config читает его при загрузке модуля).
process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-ls-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'ls-test-master-key-0123456789abcdef!!!!!';
process.env.SEED_DEMO_DATA = 'false';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
// Полный конфиг Lemon Squeezy (fail-loud требует все 9 значений).
const WEBHOOK_SECRET = 'test-ls-webhook-secret';
process.env.LEMONSQUEEZY_API_KEY = 'test-ls-api-key';
process.env.LEMONSQUEEZY_STORE_ID = '111';
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.LEMONSQUEEZY_VARIANT_STANDARD_MONTHLY = '101';
process.env.LEMONSQUEEZY_VARIANT_STANDARD_YEARLY = '102';
process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY = '201';
process.env.LEMONSQUEEZY_VARIANT_PRO_YEARLY = '202';
process.env.LEMONSQUEEZY_VARIANT_BUSINESS_MONTHLY = '301';
process.env.LEMONSQUEEZY_VARIANT_BUSINESS_YEARLY = '302';
process.env.LEMONSQUEEZY_TEST_MODE = '1'; // события с test_mode=true принимаются
// BILLING_FALLBACK НЕ задан (и амбиентный сносим): мгновенной активации нет.
delete process.env.BILLING_FALLBACK;

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');

const db = await getDb();
await migrate(db);
const app = await buildApp(db);
await app.ready();

// ── Мок LS API ───────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
interface LsCall {
  method: string;
  url: string;
  body: unknown;
}
let lsCalls: LsCall[] = [];
/** Состояние «подписки в LS», которое отдаёт GET/PATCH/DELETE мока. */
let mockSub: Record<string, unknown> = {};
let failNextLsCall = false;

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.lemonsqueezy.com')) {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      lsCalls.push({ method, url, body });
      if (failNextLsCall) {
        failNextLsCall = false;
        return new Response(JSON.stringify({ errors: [{ detail: 'boom' }] }), { status: 422 });
      }
      if (method === 'POST' && url.endsWith('/checkouts')) {
        return new Response(JSON.stringify({ data: { attributes: { url: 'https://lexab.lemonsqueezy.com/checkout/test-xyz' } } }), { status: 201 });
      }
      if (url.includes('/subscriptions/')) {
        if (method === 'PATCH' && body?.data?.attributes?.variant_id !== undefined) {
          mockSub = { ...mockSub, variant_id: String(body.data.attributes.variant_id) };
        }
        if (method === 'PATCH' && body?.data?.attributes?.cancelled === false) {
          mockSub = { ...mockSub, status: 'active', ends_at: null };
        }
        if (method === 'DELETE') {
          mockSub = { ...mockSub, status: 'cancelled', ends_at: mockSub.renews_at ?? '2027-01-01T00:00:00Z' };
        }
        return new Response(
          JSON.stringify({ data: { id: String(mockSub.id ?? 'sub-1'), attributes: { ...mockSub } } }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
beforeEach(() => {
  lsCalls = [];
  failNextLsCall = false;
});

// ── Хелперы ─────────────────────────────────────────────────────────────────
let counter = 0;
async function makeUser(): Promise<{ email: string; token: string; id: string }> {
  const email = `ls${Date.now()}_${counter++}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  const { id, verify_token } = row.rows[0];
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
  assert.equal(login.statusCode, 200, login.body);
  return { email, id, token: JSON.parse(login.body).token };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const sign = (body: string) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

/** Событие с объектом подписки (subscription_created/updated/…). */
function subEvent(eventName: string, opts: {
  userId?: string;
  subId?: string;
  variantId?: string;
  status?: string;
  renewsAt?: string | null;
  endsAt?: string | null;
  updatedAt: string;
  nonce?: string;
}): string {
  return JSON.stringify({
    meta: { event_name: eventName, webhook_id: 'wh-config-1', ...(opts.userId ? { custom_data: { user_id: opts.userId } } : {}), ...(opts.nonce ? { nonce: opts.nonce } : {}) },
    data: {
      type: 'subscriptions',
      id: opts.subId ?? 'sub-1',
      attributes: {
        store_id: 111,
        customer_id: 'cust-1',
        variant_id: opts.variantId ?? '201',
        status: opts.status ?? 'active',
        renews_at: opts.renewsAt === undefined ? '2026-09-01T00:00:00Z' : opts.renewsAt,
        ends_at: opts.endsAt ?? null,
        updated_at: opts.updatedAt,
        test_mode: true,
        urls: { customer_portal: 'https://lexab.lemonsqueezy.com/billing?signed' },
      },
    },
  });
}

/** Invoice-событие (subscription_payment_*): БЕЗ variant/renews_at. */
function invoiceEvent(eventName: string, opts: { userId?: string; subId?: string }): string {
  return JSON.stringify({
    meta: { event_name: eventName, webhook_id: 'wh-config-1', ...(opts.userId ? { custom_data: { user_id: opts.userId } } : {}) },
    data: {
      type: 'subscription-invoices',
      id: `inv-${Date.now()}-${counter++}`,
      attributes: { store_id: 111, subscription_id: opts.subId ?? 'sub-1', status: 'paid', test_mode: true },
    },
  });
}

async function postWebhook(body: string, signature?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    payload: body,
    headers: { 'content-type': 'application/json', 'x-signature': signature ?? sign(body) },
  });
}

const subRow = (userId: string) =>
  db
    .query<{
      plan: string;
      period: string | null;
      status: string;
      renews_at: Date | string | null;
      cancel_at_period_end: boolean;
      ls_subscription_id: string | null;
      ls_variant_id: string | null;
    }>(
      'SELECT plan, period, status, renews_at, cancel_at_period_end, ls_subscription_id, ls_variant_id FROM subscriptions WHERE user_id = $1',
      [userId],
    )
    .then((r) => r.rows[0]);

// ── Вебхук ──────────────────────────────────────────────────────────────────
describe('lemon squeezy webhook', () => {
  it('битая подпись → 401 и ноль side-effects', async () => {
    const u = await makeUser();
    const body = subEvent('subscription_created', { userId: u.id, subId: 'sub-sig', updatedAt: '2026-08-01T10:00:00Z' });
    const res = await postWebhook(body, 'deadbeef'.repeat(8));
    assert.equal(res.statusCode, 401);
    const row = await subRow(u.id);
    assert.equal(row?.plan ?? 'Free', 'Free');
    const j = await db.query('SELECT 1 FROM ls_webhook_events WHERE ls_subscription_id = $1', ['sub-sig']);
    assert.equal(j.rows.length, 0);
  });

  it('subscription_created активирует план с renews_at из payload', async () => {
    const u = await makeUser();
    const body = subEvent('subscription_created', {
      userId: u.id,
      subId: 'sub-a',
      variantId: '201',
      renewsAt: '2026-09-15T12:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
    });
    const res = await postWebhook(body);
    assert.equal(res.statusCode, 200, res.body);
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro');
    assert.equal(row.period, 'monthly');
    assert.equal(row.status, 'active');
    assert.equal(new Date(row.renews_at as string).toISOString(), '2026-09-15T12:00:00.000Z');
    assert.equal(row.ls_subscription_id, 'sub-a');
    assert.equal(row.ls_variant_id, '201');
    const ev = await db.query("SELECT kind FROM billing_events WHERE user_id = $1 AND kind = 'checkout'", [u.id]);
    assert.equal(ev.rows.length, 1);
  });

  it('повтор того же тела — дубликат: второй активации нет', async () => {
    const u = await makeUser();
    const body = subEvent('subscription_created', { userId: u.id, subId: 'sub-b', updatedAt: '2026-08-01T10:00:00Z' });
    assert.equal((await postWebhook(body)).statusCode, 200);
    const res2 = await postWebhook(body);
    assert.equal(res2.statusCode, 200);
    assert.equal(JSON.parse(res2.body).duplicate, true);
    const ev = await db.query("SELECT 1 FROM billing_events WHERE user_id = $1 AND kind = 'checkout'", [u.id]);
    assert.equal(ev.rows.length, 1);
  });

  it('устаревший updated_at (перестановка событий) — skip', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_updated', { userId: u.id, subId: 'sub-c', variantId: '201', updatedAt: '2026-08-02T10:00:00Z' }));
    // «Старое» событие с более ранним updated_at и другим вариантом — должно быть проигнорировано.
    const res = await postWebhook(
      subEvent('subscription_updated', { userId: u.id, subId: 'sub-c', variantId: '101', updatedAt: '2026-08-01T09:00:00Z', nonce: 'older' }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, 'skipped');
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro'); // не откатился на Standard
  });

  it('payment_success ДО created: подписка добирается из API и активируется', async () => {
    const u = await makeUser();
    mockSub = {
      id: 'sub-d',
      store_id: 111,
      customer_id: 'cust-1',
      variant_id: '102',
      status: 'active',
      renews_at: '2027-08-01T00:00:00Z',
      ends_at: null,
      updated_at: '2026-08-01T11:00:00Z',
      test_mode: true,
    };
    const res = await postWebhook(invoiceEvent('subscription_payment_success', { userId: u.id, subId: 'sub-d' }));
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(lsCalls.some((c) => c.method === 'GET' && c.url.includes('/subscriptions/sub-d')));
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Standard');
    assert.equal(row.period, 'yearly');
    assert.equal(row.ls_subscription_id, 'sub-d');
  });

  it('неизвестный пользователь → 200 skipped (ретраи не помогут)', async () => {
    const body = subEvent('subscription_created', { userId: 'no-such-user', subId: 'sub-e', updatedAt: '2026-08-01T10:00:00Z' });
    const res = await postWebhook(body);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, 'skipped');
  });

  it('неизвестный variant → 500 + журнал error (LS будет ретраить)', async () => {
    const u = await makeUser();
    const body = subEvent('subscription_created', { userId: u.id, subId: 'sub-f', variantId: '999', updatedAt: '2026-08-01T10:00:00Z' });
    const res = await postWebhook(body);
    assert.equal(res.statusCode, 500);
    const j = await db.query<{ status: string; error: string }>(
      "SELECT status, error FROM ls_webhook_events WHERE event_name = 'subscription_created' AND status = 'error' AND error LIKE '%unknown Lemon Squeezy variant%'",
    );
    assert.ok(j.rows.length >= 1);
    // Ретрай того же тела НЕ считается дубликатом (упавшие обрабатываются заново).
    const res2 = await postWebhook(body);
    assert.equal(res2.statusCode, 500);
    assert.notEqual(JSON.parse(res2.body).duplicate, true);
  });

  it('cancelled → флаг отмены + renews_at из ends_at; поздний active снимает флаг', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-g', updatedAt: '2026-08-01T10:00:00Z' }));
    const res = await postWebhook(
      subEvent('subscription_cancelled', { userId: u.id, subId: 'sub-g', status: 'cancelled', endsAt: '2026-09-01T00:00:00Z', updatedAt: '2026-08-02T10:00:00Z' }),
    );
    assert.equal(res.statusCode, 200);
    let row = await subRow(u.id);
    assert.equal(row.cancel_at_period_end, true);
    assert.equal(new Date(row.renews_at as string).toISOString(), '2026-09-01T00:00:00.000Z');
    // resumed: active без ends_at, более поздний updated_at → флаг снят.
    await postWebhook(subEvent('subscription_resumed', { userId: u.id, subId: 'sub-g', status: 'active', endsAt: null, updatedAt: '2026-08-03T10:00:00Z' }));
    row = await subRow(u.id);
    assert.equal(row.cancel_at_period_end, false);
    const ev = await db.query("SELECT 1 FROM billing_events WHERE user_id = $1 AND kind = 'resumed'", [u.id]);
    assert.ok(ev.rows.length >= 1);
  });

  it('payment_failed → past_due (по правде API); expired → Free + отвязка провайдера', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-h', updatedAt: '2026-08-01T10:00:00Z' }));
    // payment_failed теперь сверяется с API: мок отдаёт подписку в past_due.
    mockSub = {
      id: 'sub-h', store_id: 111, customer_id: 'cust-1', variant_id: '201',
      status: 'past_due', renews_at: '2026-09-01T00:00:00Z', ends_at: null,
      updated_at: '2026-08-05T10:00:00Z', test_mode: true,
    };
    const fail = await postWebhook(invoiceEvent('subscription_payment_failed', { userId: u.id, subId: 'sub-h' }));
    assert.equal(fail.statusCode, 200);
    let row = await subRow(u.id);
    assert.equal(row.status, 'past_due');
    const exp = await postWebhook(subEvent('subscription_expired', { userId: u.id, subId: 'sub-h', status: 'expired', updatedAt: '2026-08-20T10:00:00Z' }));
    assert.equal(exp.statusCode, 200);
    row = await subRow(u.id);
    assert.equal(row.plan, 'Free');
    assert.equal(row.status, 'active');
    assert.equal(row.ls_subscription_id, null);
    assert.equal(row.ls_variant_id, null);
  });

  it('запоздавший payment_failed НЕ роняет восстановленную подписку (API говорит active)', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-rec', updatedAt: '2026-08-01T10:00:00Z' }));
    mockSub = {
      id: 'sub-rec', store_id: 111, customer_id: 'cust-1', variant_id: '201',
      status: 'active', renews_at: '2026-10-01T00:00:00Z', ends_at: null,
      updated_at: '2026-08-06T10:00:00Z', test_mode: true,
    };
    const res = await postWebhook(invoiceEvent('subscription_payment_failed', { userId: u.id, subId: 'sub-rec' }));
    assert.equal(res.statusCode, 200);
    const row = await subRow(u.id);
    assert.equal(row.status, 'active'); // не past_due — платёж уже восстановлен
  });

  it('ЧУЖАЯ подписка: разрушительное событие (expired) не трогает привязанную живую', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-live', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }));
    // Событие expired от ДРУГОЙ (старой/зомби) подписки того же пользователя.
    const res = await postWebhook(
      subEvent('subscription_expired', { userId: u.id, subId: 'sub-zombie', status: 'expired', updatedAt: '2026-08-05T10:00:00Z' }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).status, 'skipped');
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro'); // живая подписка не пострадала
    assert.equal(row.ls_subscription_id, 'sub-live');
  });

  it('ЧУЖАЯ подписка со статусом active — takeover: старая отменяется у LS', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-old', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }));
    mockSub = { id: 'sub-old', store_id: 111, customer_id: 'cust-1', variant_id: '201', status: 'active', renews_at: '2026-09-01T00:00:00Z', ends_at: null, updated_at: '2026-08-06T09:00:00Z', test_mode: true };
    const res = await postWebhook(
      subEvent('subscription_created', { userId: u.id, subId: 'sub-new', variantId: '301', updatedAt: '2026-08-06T10:00:00Z', nonce: 'takeover' }),
    );
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(lsCalls.some((c) => c.method === 'DELETE' && c.url.includes('/subscriptions/sub-old')), 'старую подписку обязаны отменить у LS');
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Business');
    assert.equal(row.ls_subscription_id, 'sub-new');
  });

  it('cancelled ДО created (ретрай created в пути): оплаченный план активируется до ends_at', async () => {
    const u = await makeUser();
    const res = await postWebhook(
      subEvent('subscription_cancelled', {
        userId: u.id, subId: 'sub-oo', variantId: '201', status: 'cancelled',
        endsAt: '2026-12-31T00:00:00Z', updatedAt: '2026-08-01T10:05:00Z',
      }),
    );
    assert.equal(res.statusCode, 200, res.body);
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro'); // оплачено до ends_at — не потеряно
    assert.equal(row.cancel_at_period_end, true);
    assert.equal(new Date(row.renews_at as string).toISOString(), '2026-12-31T00:00:00.000Z');
  });

  it('paused → доступ до конца периода (флаг отмены), продления не ждём', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-pz', updatedAt: '2026-08-01T10:00:00Z' }));
    const res = await postWebhook(subEvent('subscription_paused', { userId: u.id, subId: 'sub-pz', status: 'paused', updatedAt: '2026-08-02T10:00:00Z' }));
    assert.equal(res.statusCode, 200);
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro');
    assert.equal(row.cancel_at_period_end, true);
  });
});

// ── Checkout-роут ────────────────────────────────────────────────────────────
describe('lemon squeezy checkout', () => {
  it('без consent → 400 (LS не вызывается)', async () => {
    const u = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: auth(u.token),
      payload: { plan: 'Pro', period: 'monthly' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(lsCalls.length, 0);
  });

  it('новая покупка → hosted-checkout URL + custom user_id + consent-запись', async () => {
    const u = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: auth(u.token),
      payload: { plan: 'Pro', period: 'yearly', consent: true },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.url, 'https://lexab.lemonsqueezy.com/checkout/test-xyz');
    assert.equal(body.changed, undefined);
    const call = lsCalls.find((c) => c.method === 'POST' && c.url.endsWith('/checkouts'));
    assert.ok(call);
    const attrs = (call.body as { data: { attributes: Record<string, unknown>; relationships: Record<string, { data: { id: string } }> } }).data;
    assert.equal((attrs.attributes.checkout_data as { custom: { user_id: string } }).custom.user_id, u.id);
    assert.equal(attrs.relationships.variant.data.id, '202'); // Pro yearly
    // План НЕ активировался мгновенно (нет BILLING_FALLBACK).
    const row = await subRow(u.id);
    assert.equal(row?.plan ?? 'Free', 'Free');
    const consent = await db.query("SELECT 1 FROM billing_events WHERE user_id = $1 AND kind = 'consent_waiver'", [u.id]);
    assert.equal(consent.rows.length, 1);
  });

  it('активная LS-подписка → смена тарифа PATCH-ем с проратой (changed:true)', async () => {
    const u = await makeUser();
    await postWebhook(
      subEvent('subscription_created', { userId: u.id, subId: 'sub-ch', variantId: '201', renewsAt: '2026-09-01T00:00:00Z', updatedAt: '2026-08-01T10:00:00Z' }),
    );
    mockSub = {
      id: 'sub-ch',
      store_id: 111,
      customer_id: 'cust-1',
      variant_id: '201',
      status: 'active',
      renews_at: '2026-09-01T00:00:00Z',
      ends_at: null,
      updated_at: '2026-08-05T10:00:00Z',
      test_mode: true,
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: auth(u.token),
      payload: { plan: 'Business', period: 'monthly', consent: true },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.changed, true);
    assert.equal(body.plan, 'Business');
    const patch = lsCalls.find((c) => c.method === 'PATCH' && c.url.includes('/subscriptions/sub-ch'));
    assert.ok(patch);
    // Прорированная доплата списывается СРАЗУ — иначе апгрейд можно не оплатить.
    assert.equal((patch.body as { data: { attributes: { invoice_immediately?: boolean } } }).data.attributes.invoice_immediately, true);
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Business');
    assert.equal(row.ls_variant_id, '301');
  });

  it('привязанная Free-строка + подписка ЖИВА у LS → лечение вместо второй подписки', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-heal', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }));
    // Симулируем «sweep увёл на Free, привязка осталась» (потерянные вебхуки).
    await db.query("UPDATE subscriptions SET plan = 'Free', renews_at = NULL WHERE user_id = $1", [u.id]);
    mockSub = {
      id: 'sub-heal', store_id: 111, customer_id: 'cust-1', variant_id: '201',
      status: 'active', renews_at: '2026-10-01T00:00:00Z', ends_at: null,
      updated_at: '2026-08-07T10:00:00Z', test_mode: true,
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: auth(u.token),
      payload: { plan: 'Pro', period: 'monthly', consent: true },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.url, undefined, 'второй checkout создаваться не должен');
    assert.equal(body.changed, true);
    assert.equal(body.plan, 'Pro');
    assert.ok(!lsCalls.some((c) => c.method === 'POST' && c.url.endsWith('/checkouts')));
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro');
    assert.equal(row.ls_subscription_id, 'sub-heal');
  });

  it('привязанная строка + подписки НЕТ у LS (404) → привязка чистится, выдаётся checkout', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-dead', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }));
    await db.query("UPDATE subscriptions SET plan = 'Free', renews_at = NULL WHERE user_id = $1", [u.id]);
    // Мок: GET подписки отвечает 404.
    const prev = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscriptions/sub-dead') && (init?.method ?? 'GET') === 'GET') {
        return new Response('{"errors":[{"status":"404"}]}', { status: 404 });
      }
      return prev(input as RequestInfo, init);
    }) as typeof fetch;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/billing/checkout',
        headers: auth(u.token),
        payload: { plan: 'Pro', period: 'monthly', consent: true },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.match(JSON.parse(res.body).url ?? '', /checkout/);
      const row = await subRow(u.id);
      assert.equal(row.ls_subscription_id, null);
    } finally {
      globalThis.fetch = prev;
    }
  });

  it('тот же план и период при активной подписке → 400', async () => {
    const u = await makeUser();
    await postWebhook(
      subEvent('subscription_created', { userId: u.id, subId: 'sub-same', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: auth(u.token),
      payload: { plan: 'Pro', period: 'monthly', consent: true },
    });
    assert.equal(res.statusCode, 400);
  });

  it('сбой LS при смене тарифа → 400 с подсказкой, локальный план не тронут', async () => {
    const u = await makeUser();
    await postWebhook(
      subEvent('subscription_created', { userId: u.id, subId: 'sub-fail', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }),
    );
    failNextLsCall = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: auth(u.token),
      payload: { plan: 'Business', period: 'monthly', consent: true },
    });
    assert.equal(res.statusCode, 400);
    const row = await subRow(u.id);
    assert.equal(row.plan, 'Pro');
  });
});

// ── Отмена/возврат/портал ───────────────────────────────────────────────────
describe('lemon squeezy cancel/resume/portal', () => {
  it('cancel зовёт LS, пишет ends_at; revert возобновляет', async () => {
    const u = await makeUser();
    await postWebhook(
      subEvent('subscription_created', { userId: u.id, subId: 'sub-cx', variantId: '201', renewsAt: '2026-09-01T00:00:00Z', updatedAt: '2026-08-01T10:00:00Z' }),
    );
    mockSub = {
      id: 'sub-cx',
      store_id: 111,
      customer_id: 'cust-1',
      variant_id: '201',
      status: 'active',
      renews_at: '2026-09-01T00:00:00Z',
      ends_at: null,
      updated_at: '2026-08-06T10:00:00Z',
      test_mode: true,
    };
    const cancel = await app.inject({ method: 'POST', url: '/api/billing/cancel', headers: auth(u.token), payload: {} });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.ok(lsCalls.some((c) => c.method === 'DELETE' && c.url.includes('/subscriptions/sub-cx')));
    let row = await subRow(u.id);
    assert.equal(row.cancel_at_period_end, true);

    const revert = await app.inject({ method: 'POST', url: '/api/billing/cancel/revert', headers: auth(u.token), payload: {} });
    assert.equal(revert.statusCode, 200, revert.body);
    assert.ok(lsCalls.some((c) => c.method === 'PATCH' && c.body && (c.body as { data: { attributes: { cancelled?: boolean } } }).data.attributes.cancelled === false));
    row = await subRow(u.id);
    assert.equal(row.cancel_at_period_end, false);
  });

  it('portal отдаёт подписанный URL; без LS-подписки → 400', async () => {
    const u = await makeUser();
    const none = await app.inject({ method: 'GET', url: '/api/billing/portal', headers: auth(u.token) });
    assert.equal(none.statusCode, 400);
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-p', updatedAt: '2026-08-01T10:00:00Z' }));
    mockSub = {
      id: 'sub-p',
      store_id: 111,
      customer_id: 'cust-1',
      variant_id: '201',
      status: 'active',
      renews_at: '2026-09-01T00:00:00Z',
      ends_at: null,
      updated_at: '2026-08-07T10:00:00Z',
      test_mode: true,
      urls: { customer_portal: 'https://lexab.lemonsqueezy.com/billing?signature=abc' },
    };
    const res = await app.inject({ method: 'GET', url: '/api/billing/portal', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(JSON.parse(res.body).url, /lemonsqueezy\.com\/billing/);
  });

  it('GET /billing/subscription отдаёт provider=lemonsqueezy', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-pr', updatedAt: '2026-08-01T10:00:00Z' }));
    const res = await app.inject({ method: 'GET', url: '/api/billing/subscription', headers: auth(u.token) });
    assert.equal(JSON.parse(res.body).provider, 'lemonsqueezy');
  });

  it('DELETE /me отменяет живую LS-подписку перед удалением аккаунта', async () => {
    const u = await makeUser();
    await postWebhook(subEvent('subscription_created', { userId: u.id, subId: 'sub-del', variantId: '201', updatedAt: '2026-08-01T10:00:00Z' }));
    mockSub = {
      id: 'sub-del', store_id: 111, customer_id: 'cust-1', variant_id: '201',
      status: 'active', renews_at: '2026-09-01T00:00:00Z', ends_at: null,
      updated_at: '2026-08-08T10:00:00Z', test_mode: true,
    };
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: auth(u.token),
      payload: { confirm: u.email },
    });
    assert.equal(res.statusCode, 204, res.body);
    assert.ok(
      lsCalls.some((c) => c.method === 'DELETE' && c.url.includes('/subscriptions/sub-del')),
      'подписку обязаны отменить у провайдера — иначе карта списывается вечно',
    );
    // След отмены переживает CASCADE (user_id в billing_events без FK).
    const ev = await db.query("SELECT 1 FROM billing_events WHERE user_id = $1 AND kind = 'canceled'", [u.id]);
    assert.ok(ev.rows.length >= 1);
  });
});
