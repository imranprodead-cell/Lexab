/**
 * Публичный API (тариф Business): ключи, аутентификация, асинхронный анализ,
 * месячный потолок, IDOR, отзыв, рекавери. In-memory PGlite + inject(), модель
 * замещена детерминированным фолбэком (LLM_FALLBACK=dev).
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Env ДО импорта config (он читает окружение при загрузке).
process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-apikeys-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'apikeys-test-master-key-0123456789abcdef';
process.env.SEED_DEMO_DATA = 'false';
process.env.BATCH_AUTOSTART = '0';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.BILLING_FALLBACK = 'dev';
// Маленький месячный потолок, чтобы тест 429 не создавал сотни анализов.
process.env.API_MONTHLY_LIMIT = '3';
for (const k of Object.keys(process.env)) if (k.startsWith('LEMONSQUEEZY_')) delete process.env[k];

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');
const { failInterruptedApiRequests, pruneApiRequests } = await import('../src/routes/public-api.routes.ts');

const db = await getDb();
await migrate(db);
const app = await buildApp(db);
await app.ready();

after(async () => {
  await app.close();
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

let counter = 0;
async function makeUser(): Promise<{ email: string; token: string; id: string }> {
  const email = `k${Date.now()}_${counter++}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'K', email, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  const { id, verify_token } = row.rows[0];
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
  assert.equal(login.statusCode, 200, login.body);
  return { email, id, token: JSON.parse(login.body).token };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const keyAuth = (key: string) => ({ authorization: `Bearer ${key}` });

async function makeBusinessUser(): Promise<{ email: string; token: string; id: string }> {
  const u = await makeUser();
  await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [u.id]);
  return u;
}

/** Создать ключ через кабинетный роут; вернуть { id, key }. */
async function makeKey(token: string, label = 'CI key'): Promise<{ id: string; key: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(token), payload: { label } });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.ok(body.key.startsWith('lxb_'), 'секрет с префиксом lxb_');
  return { id: body.id, key: body.key };
}

const CONTRACT_TEXT =
  'SERVICE AGREEMENT. The Supplier shall deliver the Services within 30 days. ' +
  'Payment is due within 14 days of invoice. Either party may terminate with 30 days notice. ' +
  'The liability of the Supplier is unlimited. Governing law: England and Wales.';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Поллинг статуса до done|error (фолбэк-модель отвечает за миллисекунды). */
async function waitFinished(key: string, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/analyses/${id}`, headers: keyAuth(key) });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    if (body.status !== 'processing') return body;
    await sleep(50);
  }
  assert.fail('анализ не завершился за отведённое время');
}

describe('api keys — кабинет', () => {
  it('не-Business получает 402 на всех кабинетных роутах', async () => {
    const u = await makeUser(); // Free
    for (const [method, url] of [
      ['GET', '/api/api-keys'],
      ['POST', '/api/api-keys'],
      ['GET', '/api/api-keys/usage'],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(u.token), ...(method === 'POST' ? { payload: { label: 'x' } } : {}) });
      assert.equal(res.statusCode, 402, `${method} ${url}: ${res.body}`);
    }
  });

  it('создание/список/отзыв ключа; секрет показывается один раз', async () => {
    const u = await makeBusinessUser();
    const created = await makeKey(u.token, 'Prod backend');

    const list = await app.inject({ method: 'GET', url: '/api/api-keys', headers: auth(u.token) });
    assert.equal(list.statusCode, 200);
    const rows = JSON.parse(list.body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, 'Prod backend');
    assert.ok(rows[0].keyPrefix.startsWith('lxb_'));
    assert.ok(!('key' in rows[0]), 'секрет НЕ возвращается в списке');

    const del = await app.inject({ method: 'DELETE', url: `/api/api-keys/${created.id}`, headers: auth(u.token) });
    assert.equal(del.statusCode, 204);
    const again = await app.inject({ method: 'DELETE', url: `/api/api-keys/${created.id}`, headers: auth(u.token) });
    assert.equal(again.statusCode, 404, 'повторный отзыв — 404');

    const audits = await db.query<{ n: string | number }>(
      "SELECT count(*) AS n FROM audit_events WHERE actor_id = $1 AND event_type IN ('apikey.created', 'apikey.revoked')",
      [u.id],
    );
    assert.equal(Number(audits.rows[0]?.n), 2, 'создание и отзыв в журнале аудита');
  });

  it('пустой label — 400; потолок активных ключей соблюдается', async () => {
    const u = await makeBusinessUser();
    const bad = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(u.token), payload: { label: '  ' } });
    assert.equal(bad.statusCode, 400);
    // 10 живых ключей сеем напрямую (роут создания намеренно лимитирован 10/мин).
    for (let i = 0; i < 10; i++) {
      await db.query('INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)', [
        `key_seed${counter}_${i}`,
        u.id,
        `k${i}`,
        `seedhash-${u.id}-${i}`,
        'lxb_seed0000',
      ]);
    }
    const over = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(u.token), payload: { label: 'k11' } });
    assert.equal(over.statusCode, 400, over.body);
  });
});

describe('public api — аутентификация', () => {
  it('без ключа / с мусорным / с отозванным — 401 в формате { error }', async () => {
    const none = await app.inject({ method: 'GET', url: '/api/v1/usage' });
    assert.equal(none.statusCode, 401);
    assert.equal(JSON.parse(none.body).error.code, 'missing_api_key');

    const junk = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth('lxb_definitely-not-a-key') });
    assert.equal(junk.statusCode, 401);
    assert.equal(JSON.parse(junk.body).error.code, 'invalid_api_key');

    const u = await makeBusinessUser();
    const { id, key } = await makeKey(u.token);
    await app.inject({ method: 'DELETE', url: `/api/api-keys/${id}`, headers: auth(u.token) });
    const revoked = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    assert.equal(revoked.statusCode, 401);
    assert.equal(JSON.parse(revoked.body).error.code, 'invalid_api_key');
  });

  it('даунгрейд тарифа мгновенно выключает ключ (403 plan_required)', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    await db.query("UPDATE subscriptions SET plan = 'Free' WHERE user_id = $1", [u.id]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error.code, 'plan_required');
  });

  it('ключ работает и через X-API-Key', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: { 'x-api-key': key } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).limit, 3);
  });
});

describe('public api — анализ договора', () => {
  it('полный цикл: POST text → 202 → поллинг → done с находками; журнал и usage', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token, 'Integration');

    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { text: CONTRACT_TEXT, fileName: 'msa.txt' },
    });
    assert.equal(post.statusCode, 202, post.body);
    const created202 = JSON.parse(post.body);
    const { id, status } = created202;
    assert.equal(status, 'processing');
    assert.ok(typeof created202.createdAt === 'string' && !Number.isNaN(Date.parse(created202.createdAt)), '202 несёт createdAt');

    const done = await waitFinished(key, id);
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.equal(done.fileName, 'msa.txt');
    assert.equal(typeof done.riskScore, 'number');
    assert.ok(['Low', 'Elevated', 'High'].includes(done.riskLevel as string));
    assert.equal(typeof done.summary, 'string');
    const findings = done.findings as { severity: string; title: string; verified: boolean }[];
    assert.ok(Array.isArray(findings) && findings.length > 0, 'есть находки');
    assert.equal(typeof findings[0].verified, 'boolean');

    // Анализ появился и в кабинете владельца (общие таблицы documents/analyses).
    const inCabinet = await app.inject({ method: 'GET', url: `/api/analysis/${done.analysisId}`, headers: auth(u.token) });
    assert.equal(inCabinet.statusCode, 200, 'владелец видит API-анализ в кабинете');

    // skipNotify: программный API-вызов НЕ шлёт уведомление «Анализ готов»
    // (welcome-уведомление от регистрации не в счёт — фильтруем по title_en).
    const notifs = await db.query<{ n: string | number }>(
      "SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND title_en IN ('Analysis ready', 'High risk found')",
      [u.id],
    );
    assert.equal(Number(notifs.rows[0]?.n), 0, 'API-анализ не создаёт in-app уведомлений об анализе');

    const list = await app.inject({ method: 'GET', url: '/api/v1/analyses', headers: keyAuth(key) });
    assert.equal(list.statusCode, 200);
    const items = JSON.parse(list.body).items as { id: string; status: string }[];
    assert.ok(items.some((i) => i.id === id && i.status === 'done'));

    const usage = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    const uBody = JSON.parse(usage.body);
    assert.equal(uBody.used, 1);
    assert.equal(uBody.remaining, 2);

    // Кабинетная статистика видит вызов.
    const stats = await app.inject({ method: 'GET', url: '/api/api-keys/usage', headers: auth(u.token) });
    assert.equal(stats.statusCode, 200);
    const sBody = JSON.parse(stats.body);
    assert.equal(sBody.month.used, 1);
    assert.equal(sBody.activeKeys, 1);
    assert.ok((sBody.recent as { id: string }[]).some((r) => r.id === id));
    assert.ok((sBody.days as { count: number }[]).some((d) => d.count >= 1));
  });

  it('слишком короткий text — 400; чужой id — 404 (IDOR)', async () => {
    const a = await makeBusinessUser();
    const aKey = (await makeKey(a.token)).key;
    const short = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { ...keyAuth(aKey), 'content-type': 'application/json' },
      payload: { text: 'too short' },
    });
    assert.equal(short.statusCode, 400, short.body);

    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { ...keyAuth(aKey), 'content-type': 'application/json' },
      payload: { text: CONTRACT_TEXT },
    });
    const { id } = JSON.parse(post.body);
    await waitFinished(aKey, id);

    const b = await makeBusinessUser();
    const bKey = (await makeKey(b.token)).key;
    const stolen = await app.inject({ method: 'GET', url: `/api/v1/analyses/${id}`, headers: keyAuth(bKey) });
    assert.equal(stolen.statusCode, 404, 'чужая запись невидима');
  });

  it('месячный потолок: 429 monthly_limit_exceeded, юнит не списывается', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
       VALUES ($1, date_trunc('month', now())::date, 0, 0, 3)
       ON CONFLICT (user_id, month) DO UPDATE SET api_requests = 3`,
      [u.id],
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { text: CONTRACT_TEXT },
    });
    assert.equal(res.statusCode, 429, res.body);
    assert.equal(JSON.parse(res.body).error.code, 'monthly_limit_exceeded');
    const after429 = await db.query<{ api_requests: number | string }>(
      "SELECT api_requests FROM usage_counters WHERE user_id = $1 AND month = date_trunc('month', now())::date",
      [u.id],
    );
    assert.equal(Number(after429.rows[0]?.api_requests), 3, 'счётчик не вырос');
  });

  it('Enterprise — безлимит (limit null), но used считается честно', async () => {
    const u = await makeBusinessUser();
    await db.query("UPDATE subscriptions SET plan = 'Enterprise' WHERE user_id = $1", [u.id]);
    const { key } = await makeKey(u.token);
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    const body = JSON.parse(res.body);
    assert.equal(body.limit, null);
    assert.equal(body.remaining, null);
    assert.equal(body.used, 0);
    // Прогон одного анализа — used растёт даже на безлимите (не остаётся 0).
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { text: CONTRACT_TEXT },
    });
    await waitFinished(key, JSON.parse(post.body).id);
    const after = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) })).body);
    assert.equal(after.used, 1, 'Enterprise: used отражает реальные вызовы');
    assert.equal(after.limit, null);
  });

  it('рекавери: осиротевшее задание закрывается interrupted с возвратом юнита', async () => {
    const u = await makeBusinessUser();
    const { id: keyId } = (await makeKey(u.token)) as { id: string; key: string };
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
       VALUES ($1, date_trunc('month', now())::date, 0, 0, 1)
       ON CONFLICT (user_id, month) DO UPDATE SET api_requests = 1`,
      [u.id],
    );
    await db.query(
      `INSERT INTO api_requests (id, user_id, key_id, file_name, status, created_at, updated_at)
       VALUES ('apireq_orphan1', $1, $2, 'stale.txt', 'processing', now() - interval '10 minutes', now() - interval '10 minutes')`,
      [u.id, keyId],
    );
    await failInterruptedApiRequests(db);
    const row = await db.query<{ status: string; error_code: string | null }>(
      "SELECT status, error_code FROM api_requests WHERE id = 'apireq_orphan1'",
    );
    assert.equal(row.rows[0]?.status, 'error');
    assert.equal(row.rows[0]?.error_code, 'interrupted');
    const quota = await db.query<{ api_requests: number | string }>(
      "SELECT api_requests FROM usage_counters WHERE user_id = $1 AND month = date_trunc('month', now())::date",
      [u.id],
    );
    assert.equal(Number(quota.rows[0]?.api_requests), 0, 'юнит возвращён');
  });

  it('docs-квота плана НЕ режет API до месячного лимита (skipDocQuota)', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    // Business docs-лимит 700; забиваем счётчик документов под потолок, чтобы
    // reserveDocument бросил бы 402 — но API-путь его пропускает.
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
       VALUES ($1, date_trunc('month', now())::date, 0, 700, 0)
       ON CONFLICT (user_id, month) DO UPDATE SET docs_created = 700`,
      [u.id],
    );
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { text: CONTRACT_TEXT },
    });
    assert.equal(post.statusCode, 202, post.body);
    const done = await waitFinished(key, JSON.parse(post.body).id);
    assert.equal(done.status, 'done', 'API-анализ прошёл, не упёршись в docs-квоту 700');
    // И критично: API НЕ бампает docs_created (иначе съел бы интерактивную
    // квоту — после 700 API-вызовов ручное создание документа ловило бы 402).
    const docs = await db.query<{ docs_created: number | string }>(
      "SELECT docs_created FROM usage_counters WHERE user_id = $1 AND month = date_trunc('month', now())::date",
      [u.id],
    );
    assert.equal(Number(docs.rows[0]?.docs_created), 700, 'docs_created не вырос от API-анализа');
  });

  it('дробные limit/offset в списке не роняют 500 (Math.trunc)', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const res = await app.inject({ method: 'GET', url: '/api/v1/analyses?limit=2.5&offset=1.9', headers: keyAuth(key) });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.limit, 2);
    assert.equal(body.offset, 1);
  });

  it('ретеншен: pruneApiRequests чистит старые done/error, живые и свежие не трогает', async () => {
    const u = await makeBusinessUser();
    const { id: keyId } = await makeKey(u.token);
    await db.query(
      `INSERT INTO api_requests (id, user_id, key_id, file_name, status, created_at, updated_at) VALUES
        ('apireq_old_done', $1, $2, 'old.txt', 'done', now() - interval '100 days', now() - interval '100 days'),
        ('apireq_old_proc', $1, $2, 'stuck.txt', 'processing', now() - interval '100 days', now() - interval '100 days'),
        ('apireq_fresh', $1, $2, 'new.txt', 'done', now(), now())`,
      [u.id, keyId],
    );
    await pruneApiRequests(db);
    const rows = await db.query<{ id: string }>('SELECT id FROM api_requests WHERE user_id = $1 ORDER BY id', [u.id]);
    const ids = rows.rows.map((r) => r.id);
    assert.ok(!ids.includes('apireq_old_done'), 'старый done удалён');
    assert.ok(ids.includes('apireq_old_proc'), 'старый processing НЕ тронут (живое задание)');
    assert.ok(ids.includes('apireq_fresh'), 'свежий done не тронут');
  });

  it('неизвестный v1-путь — 404 в формате { error }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.code, 'not_found');
  });
});
