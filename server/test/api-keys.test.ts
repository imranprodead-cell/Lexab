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
const { isPrivateIp, signWebhookBody } = await import('../src/lib/apiWebhooks.ts');
const crypto = await import('node:crypto');

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

describe('public api — расширенные возможности (draft/compare/template)', () => {
  const pollJob = async (key: string, url: string): Promise<Record<string, unknown>> => {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: 'GET', url, headers: keyAuth(key) });
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      if (body.status !== 'processing') return body;
      await sleep(50);
    }
    assert.fail(`job не завершился: ${url}`);
  };

  it('черновик: POST /v1/drafts → poll → done с документом; виден в кабинете; кросс-kind 404', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { prompt: 'Draft a simple mutual NDA between Acme Ltd and Globex Inc under UK law.', jurisdiction: 'UK law' },
    });
    assert.equal(post.statusCode, 202, post.body);
    const created = JSON.parse(post.body);
    const { id } = created;
    assert.equal(created.fileName, 'Draft contract', '202 несёт единообразный fileName');
    const done = await pollJob(key, `/api/v1/drafts/${id}`);
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.ok(typeof done.title === 'string' && (done.title as string).length > 0);
    assert.ok(Array.isArray(done.document) && (done.document as unknown[]).length > 0, 'есть блоки документа');
    const kindRow = await db.query<{ kind: string; analysis_id: string | null; file_name: string }>('SELECT kind, analysis_id, file_name FROM api_requests WHERE id = $1', [id]);
    assert.equal(kindRow.rows[0]?.kind, 'draft');
    assert.ok(kindRow.rows[0]?.analysis_id, 'черновик привязан к analysis');
    // Промпт НЕ хранится открытым текстом в file_name (нейтральная метка).
    assert.equal(kindRow.rows[0]?.file_name, 'Draft contract', 'промпт не утёк в file_name');
    // Черновик НЕ накручивает ревью-аналитику владельца (skipReviewStats).
    const revEvents = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM review_events WHERE analysis_id = $1', [kindRow.rows[0]!.analysis_id]);
    assert.equal(Number(revEvents.rows[0]?.n), 0, 'черновик не пишет review_events');
    const cab = await app.inject({ method: 'GET', url: `/api/analysis/${kindRow.rows[0]!.analysis_id}`, headers: auth(u.token) });
    assert.equal(cab.statusCode, 200, 'черновик виден владельцу в кабинете');
    // Кросс-kind: draft id, поданный в /analyses/:id, невидим (404).
    const wrong = await app.inject({ method: 'GET', url: `/api/v1/analyses/${id}`, headers: keyAuth(key) });
    assert.equal(wrong.statusCode, 404, 'draft id не отдаётся как analysis');
  });

  it('сравнение: POST /v1/compares (JSON) → poll → done; результат ШИФРОВАН at-rest; IDOR 404', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/compares',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { textA: CONTRACT_TEXT, textB: CONTRACT_TEXT.replace('14 days', '30 days'), nameA: 'v1', nameB: 'v2' },
    });
    assert.equal(post.statusCode, 202, post.body);
    const { id } = JSON.parse(post.body);
    const done = await pollJob(key, `/api/v1/compares/${id}`);
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.equal(typeof done.summary, 'string');
    assert.ok(Array.isArray(done.changes), 'есть список изменений');
    // Результат содержит текст пунктов договора → в БД он ЗАШИФРОВАН: сырое
    // значение result не содержит открытый текст summary.
    const raw = await db.query<{ result: unknown }>('SELECT result FROM api_requests WHERE id = $1', [id]);
    const rawStr = JSON.stringify(raw.rows[0]?.result ?? null);
    assert.ok(!rawStr.includes((done.summary as string).slice(0, 24)), 'summary не лежит в БД в открытом виде');
    // IDOR: чужой ключ не видит это сравнение.
    const b = await makeBusinessUser();
    const bKey = (await makeKey(b.token)).key;
    const stolen = await app.inject({ method: 'GET', url: `/api/v1/compares/${id}`, headers: keyAuth(bKey) });
    assert.equal(stolen.statusCode, 404, 'чужое сравнение невидимо');
  });

  it('шаблон: каталог → generate → poll → done { title, content }; квота растёт', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    await db.query(
      "INSERT INTO templates (id, name, name_ru, category, description, description_ru, jurisdiction, clauses) VALUES ('t_api_test', 'API Test NDA', 'Тест NDA', 'Confidentiality', 'Test template for API.', 'Тест-шаблон.', 'UK', 8) ON CONFLICT (id) DO NOTHING",
    );
    const list = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: keyAuth(key) });
    assert.equal(list.statusCode, 200);
    const items = JSON.parse(list.body).items as { id: string }[];
    assert.ok(items.some((t) => t.id === 't_api_test'), 'шаблон в каталоге');
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/t_api_test/generate',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { partyA: 'Acme Ltd', partyB: 'Globex Inc', details: 'Mutual NDA for a pilot integration project.' },
    });
    assert.equal(post.statusCode, 202, post.body);
    const { id } = JSON.parse(post.body);
    const done = await pollJob(key, `/api/v1/templates/requests/${id}`);
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.equal(typeof done.title, 'string');
    assert.ok(typeof done.content === 'string' && (done.content as string).length > 50, 'есть текст договора');
    const usage = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) })).body);
    assert.equal(usage.used, 1, 'вызов шаблона списал один месячный юнит');
  });

  it('несуществующий шаблон → 404 { error }', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/nope/generate',
      headers: { ...keyAuth(key), 'content-type': 'application/json' },
      payload: { partyA: 'A', partyB: 'B', details: 'details here for the deal' },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.code, 'not_found');
  });
});

describe('public api — вебхуки + ссылка-отчёт (Фаза 2)', () => {
  const pollJob = async (key: string, url: string): Promise<Record<string, unknown>> => {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: 'GET', url, headers: keyAuth(key) });
      const body = JSON.parse(res.body);
      if (body.status !== 'processing') return body;
      await sleep(50);
    }
    assert.fail(`job не завершился: ${url}`);
  };

  it('isPrivateIp: приватные/публичные + mapped/hex IPv6 (регрессия SSRF)', () => {
    for (const ip of [
      '10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1',
      '::1', 'fe80::1', 'fd00::1', 'not-an-ip',
      // Ранее проскакивавшие обходы: IPv4-mapped IPv6 в точечной И hex-форме,
      // весь fe80::/10, IPv4-compatible, NAT64.
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
      '::ffff:10.0.0.1', '::ffff:0a00:0001', 'fe8f::1', 'fe81::1', 'fe8a::1', '64:ff9b::7f00:1', '::127.0.0.1',
    ]) {
      assert.equal(isPrivateIp(ip), true, `${ip} должен быть приватным`);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8', '::ffff:0808:0808']) {
      assert.equal(isPrivateIp(ip), false, `${ip} должен быть публичным`);
    }
  });

  it('signWebhookBody: HMAC-SHA256 совпадает с проверкой клиента', () => {
    const sig = signWebhookBody('whsec_test', '{"a":1}');
    const expected = crypto.createHmac('sha256', 'whsec_test').update('{"a":1}', 'utf8').digest('hex');
    assert.equal(sig, expected);
  });

  it('SSRF: приватный/http/userinfo URL вебхука → 400', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const bad = [
      'http://93.184.216.34/hook', // не https
      'https://127.0.0.1/hook', // loopback
      'https://192.168.1.10/hook', // private
      'https://169.254.169.254/latest/meta-data', // link-local (метаданные облака)
      'https://[::1]/hook', // IPv6 loopback
      'https://[::ffff:169.254.169.254]/meta', // IPv4-mapped IPv6 → метаданные (был обход!)
      'https://[::ffff:127.0.0.1]/hook', // IPv4-mapped IPv6 → loopback
      'https://user:pass@93.184.216.34/hook', // userinfo
      'not-a-url',
    ];
    for (const url of bad) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { url } });
      assert.equal(res.statusCode, 400, `${url} должен быть отклонён: ${res.body}`);
      assert.ok(['invalid_webhook_url', 'webhook_ssrf'].includes(JSON.parse(res.body).error.code), `${url} → ${res.body}`);
    }
  });

  it('вебхук CRUD: создать (публичный IP) → список маскирован → отзыв', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const create = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { url: 'https://93.184.216.34/hook/secret-path' } });
    assert.equal(create.statusCode, 201, create.body);
    const ep = JSON.parse(create.body);
    assert.ok(String(ep.signingSecret).startsWith('whsec_'), 'секрет подписи выдан один раз');
    const list = await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: keyAuth(key) });
    const items = JSON.parse(list.body).items as { id: string; maskedUrl: string }[];
    assert.ok(items.some((i) => i.id === ep.id));
    assert.ok(!items[0].maskedUrl.includes('secret-path'), 'путь URL (может нести секрет) скрыт');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/webhooks/${ep.id}`, headers: keyAuth(key) });
    assert.equal(del.statusCode, 204);
    const again = await app.inject({ method: 'DELETE', url: `/api/v1/webhooks/${ep.id}`, headers: keyAuth(key) });
    assert.equal(again.statusCode, 404);
  });

  it('доставка: подписана, минимальна (без текста), 2xx → delivered', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const create = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { url: 'https://93.184.216.34/hook' } });
    const { signingSecret } = JSON.parse(create.body);

    const calls: { url: string; body: string; sig: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, opts: { body?: string; headers?: Record<string, string> } = {}) => {
      calls.push({ url: String(url), body: String(opts.body ?? ''), sig: opts.headers?.['X-Lexab-Signature'] ?? '' });
      return new Response('ok', { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const post = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { prompt: 'Draft a mutual NDA' } });
      const { id } = JSON.parse(post.body);
      await pollJob(key, `/api/v1/drafts/${id}`);
      for (let i = 0; i < 60 && calls.length === 0; i++) await sleep(25);
      assert.ok(calls.length >= 1, 'вебхук отправлен');
      const c = calls[0];
      const expected = crypto.createHmac('sha256', signingSecret).update(c.body, 'utf8').digest('hex');
      assert.equal(c.sig, expected, 'подпись HMAC верна');
      const payload = JSON.parse(c.body);
      assert.equal(payload.event, 'draft.done');
      assert.equal(payload.id, id);
      assert.equal(payload.kind, 'draft');
      assert.equal(payload.status, 'done');
      assert.ok(!('findings' in payload) && !('document' in payload) && !('summary' in payload), 'payload без контента договора');
      for (let i = 0; i < 60; i++) {
        const d = await db.query<{ status: string }>('SELECT status FROM api_webhook_deliveries WHERE api_request_id = $1', [id]);
        if (d.rows[0]?.status === 'delivered') break;
        await sleep(25);
      }
      const d = await db.query<{ status: string; response_code: number | null }>('SELECT status, response_code FROM api_webhook_deliveries WHERE api_request_id = $1', [id]);
      assert.equal(d.rows[0]?.status, 'delivered');
      assert.equal(d.rows[0]?.response_code, 200);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('доставка: 5xx → ретрай с бэкоффом (queued, attempts>0, next_attempt в будущем)', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { url: 'https://93.184.216.34/hook' } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('err', { status: 500 })) as typeof globalThis.fetch;
    try {
      const post = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { prompt: 'Draft an NDA' } });
      const { id } = JSON.parse(post.body);
      await pollJob(key, `/api/v1/drafts/${id}`);
      let row: { status: string; attempts: number; future: boolean } | undefined;
      for (let i = 0; i < 80; i++) {
        const d = await db.query<{ status: string; attempts: number; future: boolean }>(
          'SELECT status, attempts, (next_attempt_at > now()) AS future FROM api_webhook_deliveries WHERE api_request_id = $1',
          [id],
        );
        row = d.rows[0];
        if (row && row.attempts > 0) break;
        await sleep(25);
      }
      assert.equal(row?.status, 'queued', 'после 5xx осталось в очереди на ретрай');
      assert.ok((row?.attempts ?? 0) >= 1, 'попытка засчитана');
      assert.equal(row?.future, true, 'следующая попытка отложена (бэкофф)');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('DELETE /me каскадно сносит вебхук-эндпоинты и доставки', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const cr = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { url: 'https://93.184.216.34/hook' } });
    const epId = JSON.parse(cr.body).id;
    await db.query(
      "INSERT INTO api_webhook_deliveries (id, endpoint_id, user_id, event, payload, status) VALUES ('whd_casc', $2, $1, 'analysis.done', '{}'::jsonb, 'queued')",
      [u.id, epId],
    );
    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: { ...auth(u.token), 'content-type': 'application/json' }, payload: { confirm: u.email } });
    assert.equal(del.statusCode, 204, del.body);
    const ep = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM api_webhook_endpoints WHERE user_id = $1', [u.id]);
    const dl = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM api_webhook_deliveries WHERE user_id = $1', [u.id]);
    assert.equal(Number(ep.rows[0]?.n), 0, 'эндпоинты снесены каскадом');
    assert.equal(Number(dl.rows[0]?.n), 0, 'доставки снесены каскадом');
  });

  it('reportUrl: ?report=1 отдаёт ссылку /share, без — не отдаёт', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const post = await app.inject({ method: 'POST', url: '/api/v1/analyses', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { text: CONTRACT_TEXT } });
    const { id } = JSON.parse(post.body);
    await pollJob(key, `/api/v1/analyses/${id}`);
    const withReport = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/analyses/${id}?report=1`, headers: keyAuth(key) })).body);
    assert.ok(typeof withReport.reportUrl === 'string' && withReport.reportUrl.includes('/share/'), 'reportUrl есть при ?report=1');
    const noReport = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/analyses/${id}`, headers: keyAuth(key) })).body);
    assert.ok(!('reportUrl' in noReport), 'без ?report reportUrl нет');
    // Ссылка ведёт на публичный отчёт (тот же анализ).
    const token = String(withReport.reportUrl).split('/share/')[1];
    const share = await app.inject({ method: 'GET', url: `/api/share/${token}` });
    assert.equal(share.statusCode, 200, 'публичный отчёт открывается');
  });
});

/** Создать ключ с опциями Фазы 3 (scopes/expiresInDays). */
async function makeScopedKey(
  token: string,
  opts: { label?: string; scopes?: string[]; expiresInDays?: number | null } = {},
): Promise<{ id: string; key: string; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/api-keys',
    headers: auth(token),
    payload: { label: opts.label ?? 'Scoped key', ...(opts.scopes ? { scopes: opts.scopes } : {}), ...(opts.expiresInDays !== undefined ? { expiresInDays: opts.expiresInDays } : {}) },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  return { id: body.id, key: body.key, body };
}

/** Активный участник команды owner'а с ролью role (сеем напрямую — быстрее invite-цикла). */
async function makeTeamMember(ownerId: string, role: 'admin' | 'editor' | 'viewer'): Promise<{ email: string; token: string; id: string }> {
  const m = await makeUser();
  await db.query(
    "INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status) VALUES ($1, $2, $3, 'M', $4, $5, 'active')",
    [`tm_${counter++}_${Date.now()}`, ownerId, m.id, m.email, role],
  );
  return m;
}

describe('фаза 3 — скоупы ключей', () => {
  it('каталог скоупов отдаётся кабинету', async () => {
    const u = await makeBusinessUser();
    const res = await app.inject({ method: 'GET', url: '/api/api-keys/scopes', headers: auth(u.token) });
    assert.equal(res.statusCode, 200);
    const { scopes } = JSON.parse(res.body);
    assert.ok(scopes.includes('analyses:write') && scopes.includes('webhooks:manage'));
  });

  it('неизвестный скоуп при создании — 400; не-массив — 400', async () => {
    const u = await makeBusinessUser();
    const bad = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(u.token), payload: { label: 'x', scopes: ['nope:hack'] } });
    assert.equal(bad.statusCode, 400, bad.body);
    const notArr = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(u.token), payload: { label: 'x', scopes: 'analyses:write' } });
    assert.equal(notArr.statusCode, 400, notArr.body);
  });

  it('ограниченный ключ: 403 insufficient_scope на чужой операции, работа на своей', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeScopedKey(u.token, { scopes: ['drafts:write'] });
    // Чужие операции — 403 с машиночитаемым кодом.
    for (const [method, url, payload] of [
      ['POST', '/api/v1/analyses', { text: CONTRACT_TEXT }],
      ['GET', '/api/v1/analyses', undefined],
      ['POST', '/api/v1/webhooks', { url: 'https://example.com/h' }],
      ['GET', '/api/v1/webhooks', undefined],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: { ...keyAuth(key), 'content-type': 'application/json' },
        ...(payload ? { payload } : {}),
      });
      assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
      assert.equal(JSON.parse(res.body).error.code, 'insufficient_scope');
    }
    // Своя операция проходит (и поллинг своим же скоупом).
    const post = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { prompt: 'Draft an NDA' } });
    assert.equal(post.statusCode, 202, post.body);
    const get = await app.inject({ method: 'GET', url: `/api/v1/drafts/${JSON.parse(post.body).id}`, headers: keyAuth(key) });
    assert.equal(get.statusCode, 200, get.body);
  });

  it('read-скоуп читает, но не пишет; пустые скоупы = полный доступ', async () => {
    const u = await makeBusinessUser();
    const { key: readKey } = await makeScopedKey(u.token, { scopes: ['analyses:read'] });
    const list = await app.inject({ method: 'GET', url: '/api/v1/analyses', headers: keyAuth(readKey) });
    assert.equal(list.statusCode, 200, list.body);
    const write = await app.inject({ method: 'POST', url: '/api/v1/analyses', headers: { ...keyAuth(readKey), 'content-type': 'application/json' }, payload: { text: CONTRACT_TEXT } });
    assert.equal(write.statusCode, 403, write.body);
    // Ключ без scopes (легаси/по умолчанию) — всё разрешено.
    const { key: fullKey } = await makeKey(u.token);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/analyses', headers: { ...keyAuth(fullKey), 'content-type': 'application/json' }, payload: { text: CONTRACT_TEXT } });
    assert.equal(ok.statusCode, 202, ok.body);
  });
});

describe('фаза 3 — срок действия и ротация', () => {
  it('expiresInDays задаёт срок; просроченный ключ = 401; список показывает expired', async () => {
    const u = await makeBusinessUser();
    const { id, key, body } = await makeScopedKey(u.token, { expiresInDays: 30 });
    assert.ok(body.expiresAt, 'expiresAt в ответе создания');
    const ok = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    assert.equal(ok.statusCode, 200, 'непросроченный ключ работает');
    // Просрочиваем вручную (не ждать же 30 дней).
    await db.query("UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    const dead = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    assert.equal(dead.statusCode, 401, dead.body);
    assert.equal(JSON.parse(dead.body).error.code, 'invalid_api_key');
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/api-keys', headers: auth(u.token) })).body);
    const row = list.find((k: { id: string }) => k.id === id);
    assert.equal(row?.expired, true, 'кабинет показывает истёкший ключ с флагом');
    // Кривой срок — 400.
    const bad = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(u.token), payload: { label: 'x', expiresInDays: 0 } });
    assert.equal(bad.statusCode, 400);
  });

  it('ротация: старый мёртв мгновенно, новый наследует label+скоупы, счёт живых не растёт', async () => {
    const u = await makeBusinessUser();
    const { id, key } = await makeScopedKey(u.token, { label: 'Rotate me', scopes: ['drafts:write'] });
    const rot = await app.inject({ method: 'POST', url: `/api/api-keys/${id}/rotate`, headers: { ...auth(u.token), 'content-type': 'application/json' }, payload: {} });
    assert.equal(rot.statusCode, 201, rot.body);
    const fresh = JSON.parse(rot.body);
    assert.equal(fresh.label, 'Rotate me');
    assert.deepEqual(fresh.scopes, ['drafts:write'], 'скоупы унаследованы');
    assert.ok(fresh.key.startsWith('lxb_') && fresh.key !== key, 'новый секрет');
    // Старый ключ мёртв, новый работает и несёт те же права.
    const old = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(key) });
    assert.equal(old.statusCode, 401, 'старый ключ отозван');
    const draft = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(fresh.key), 'content-type': 'application/json' }, payload: { prompt: 'Draft a lease' } });
    assert.equal(draft.statusCode, 202, draft.body);
    const denied = await app.inject({ method: 'POST', url: '/api/v1/analyses', headers: { ...keyAuth(fresh.key), 'content-type': 'application/json' }, payload: { text: CONTRACT_TEXT } });
    assert.equal(denied.statusCode, 403, 'скоупы применяются и к ротированному');
    const live = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    assert.equal(Number(live.rows[0]?.n), 1, 'ротация не плодит живые ключи');
    // Ротация несуществующего/уже отозванного — 404.
    const again = await app.inject({ method: 'POST', url: `/api/api-keys/${id}/rotate`, headers: { ...auth(u.token), 'content-type': 'application/json' }, payload: {} });
    assert.equal(again.statusCode, 404);
  });
});

describe('фаза 3 — командные ключи', () => {
  it('админ команды создаёт/видит/отзывает ключ под квотой владельца; editor — 403', async () => {
    const owner = await makeBusinessUser();
    const admin = await makeTeamMember(owner.id, 'admin');
    const editor = await makeTeamMember(owner.id, 'editor');

    // Админ (личный план Free!) создаёт командный ключ — наследует Business владельца.
    const cr = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(admin.token), payload: { label: 'Team CI' } });
    assert.equal(cr.statusCode, 201, cr.body);
    const created = JSON.parse(cr.body);
    // Ключ принадлежит владельцу (квота/лимиты по нему), created_by = админ.
    const row = await db.query<{ user_id: string; created_by: string; team_owner_id: string }>('SELECT user_id, created_by, team_owner_id FROM api_keys WHERE id = $1', [created.id]);
    assert.equal(row.rows[0]?.user_id, owner.id, 'ключ на владельце команды');
    assert.equal(row.rows[0]?.created_by, admin.id, 'создатель зафиксирован');
    assert.equal(row.rows[0]?.team_owner_id, owner.id);

    // И владелец, и админ видят ключ в списке (с именем создателя).
    for (const t of [owner.token, admin.token]) {
      const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/api-keys', headers: auth(t) })).body);
      const found = list.find((k: { id: string }) => k.id === created.id);
      assert.ok(found, 'ключ виден');
      assert.equal(found.createdBy, 'K', 'имя создателя (users.name) в списке');
    }

    // Вызов по командному ключу идёт под квоту ВЛАДЕЛЬЦА.
    const post = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(created.key), 'content-type': 'application/json' }, payload: { prompt: 'Draft an SLA' } });
    assert.equal(post.statusCode, 202, post.body);
    const job = await db.query<{ user_id: string }>('SELECT user_id FROM api_requests WHERE id = $1', [JSON.parse(post.body).id]);
    assert.equal(job.rows[0]?.user_id, owner.id, 'задание на владельце (его квота)');

    // Editor и viewer управлять ключами не могут.
    for (const [method, url] of [
      ['GET', '/api/api-keys'],
      ['POST', '/api/api-keys'],
      ['DELETE', `/api/api-keys/${created.id}`],
      ['POST', `/api/api-keys/${created.id}/rotate`],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: method === 'POST' ? { ...auth(editor.token), 'content-type': 'application/json' } : auth(editor.token),
        ...(method === 'POST' ? { payload: { label: 'x' } } : {}),
      });
      assert.equal(res.statusCode, 403, `${method} ${url} для editor: ${res.body}`);
    }

    // Админ отзывает командный ключ.
    const del = await app.inject({ method: 'DELETE', url: `/api/api-keys/${created.id}`, headers: auth(admin.token) });
    assert.equal(del.statusCode, 204, del.body);
    const gone = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(created.key) });
    assert.equal(gone.statusCode, 401, 'отозванный командный ключ мёртв');
  });
});

describe('фаза 3 — фиксы ревью', () => {
  it('свой Business-план не отбирают: участник чужой команды правит СВОИ ключи', async () => {
    // U — самостоятельный Business, создал свой ключ.
    const u = await makeBusinessUser();
    const { id: ownKeyId } = await makeKey(u.token, 'Personal');
    // U приглашён viewer'ом в чужую Business-команду.
    const other = await makeBusinessUser();
    await db.query(
      "INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status) VALUES ($1, $2, $3, 'U', $4, 'viewer', 'active')",
      [`tm_self_${counter++}`, other.id, u.id, u.email],
    );
    // Раньше это запирало U из его же ключей (403). Теперь U управляет своими.
    const list = await app.inject({ method: 'GET', url: '/api/api-keys', headers: auth(u.token) });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(JSON.parse(list.body).some((k: { id: string }) => k.id === ownKeyId), 'свой ключ виден');
    const del = await app.inject({ method: 'DELETE', url: `/api/api-keys/${ownKeyId}`, headers: auth(u.token) });
    assert.equal(del.statusCode, 204, 'свой ключ отзывается');
  });

  it('оффбординг: удаление участника отзывает созданные им командные ключи и вебхуки', async () => {
    const owner = await makeBusinessUser();
    const admin = await makeTeamMember(owner.id, 'admin');
    const memberRow = await db.query<{ id: string }>('SELECT id FROM team_members WHERE member_user_id = $1', [admin.id]);
    const teamKey = JSON.parse((await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(admin.token), payload: { label: 'Admin CI' } })).body);
    // Админ регистрирует вебхук своим ключом (эндпоинт под владельцем).
    const wh = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth(teamKey.key), 'content-type': 'application/json' }, payload: { url: 'https://93.184.216.34/hook' } });
    assert.equal(wh.statusCode, 201, wh.body);
    // Владелец исключает админа.
    const rm = await app.inject({ method: 'DELETE', url: `/api/team/members/${memberRow.rows[0].id}`, headers: auth(owner.token) });
    assert.equal(rm.statusCode, 204, rm.body);
    // Ключ ушедшего мёртв, вебхук отозван.
    const dead = await app.inject({ method: 'GET', url: '/api/v1/usage', headers: keyAuth(teamKey.key) });
    assert.equal(dead.statusCode, 401, 'ключ ушедшего админа отозван');
    const liveWh = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM api_webhook_endpoints WHERE user_id = $1 AND revoked_at IS NULL', [owner.id]);
    assert.equal(Number(liveWh.rows[0]?.n), 0, 'вебхук ушедшего отозван');
  });

  it('ротация тайм-боксного ключа наследует срок (не становится вечным)', async () => {
    const u = await makeBusinessUser();
    const { id } = await makeScopedKey(u.token, { label: 'Boxed', expiresInDays: 30 });
    const rot = JSON.parse((await app.inject({ method: 'POST', url: `/api/api-keys/${id}/rotate`, headers: { ...auth(u.token), 'content-type': 'application/json' }, payload: {} })).body);
    assert.ok(rot.expiresAt, 'ротированный ключ сохранил срок');
    // Наследованный срок близок к исходному (в пределах суток).
    assert.ok(new Date(rot.expiresAt).getTime() > Date.now(), 'срок в будущем');
    // Явное продление тоже работает.
    const rot2 = JSON.parse((await app.inject({ method: 'POST', url: `/api/api-keys/${rot.id}/rotate`, headers: { ...auth(u.token), 'content-type': 'application/json' }, payload: { expiresInDays: 365 } })).body);
    assert.ok(new Date(rot2.expiresAt).getTime() - Date.now() > 300 * 86_400_000, 'явный expiresInDays продлил');
  });

  it('истёкшие ключи не занимают слот MAX_LIVE_KEYS', async () => {
    const u = await makeBusinessUser();
    // 10 истёкших ключей напрямую.
    for (let i = 0; i < 10; i++) {
      await db.query(
        "INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, expires_at) VALUES ($1, $2, $3, $4, 'lxb_exp00000', now() - interval '1 day')",
        [`key_exp${counter}_${i}`, u.id, `exp${i}`, `exphash-${u.id}-${i}`],
      );
    }
    // Создание нового проходит — истёкшие не считаются живыми.
    const ok = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(u.token), payload: { label: 'fresh' } });
    assert.equal(ok.statusCode, 201, ok.body);
    const usage = JSON.parse((await app.inject({ method: 'GET', url: '/api/api-keys/usage', headers: auth(u.token) })).body);
    assert.equal(usage.activeKeys, 1, 'истёкшие не в activeKeys');
  });

  it('идемпотентность пер-ключевая: два ключа с одним Idempotency-Key не сталкиваются', async () => {
    const u = await makeBusinessUser();
    const { key: k1 } = await makeKey(u.token, 'Dept A');
    const { key: k2 } = await makeKey(u.token, 'Dept B');
    const idem = `shared-${Date.now()}`;
    const r1 = JSON.parse((await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(k1), 'content-type': 'application/json', 'idempotency-key': idem }, payload: { prompt: 'Draft A' } })).body);
    const r2 = JSON.parse((await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(k2), 'content-type': 'application/json', 'idempotency-key': idem }, payload: { prompt: 'Draft B' } })).body);
    assert.notEqual(r1.id, r2.id, 'разные ключи — разные задания при одинаковом idem-строке');
  });
});

describe('фаза 3 — идемпотентность', () => {
  it('повтор POST с тем же Idempotency-Key возвращает то же задание без второго списания', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const h = { ...keyAuth(key), 'content-type': 'application/json', 'idempotency-key': `retry-${Date.now()}` };
    const first = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: h, payload: { prompt: 'Draft an NDA' } });
    assert.equal(first.statusCode, 202, first.body);
    const id1 = JSON.parse(first.body).id;
    const second = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: h, payload: { prompt: 'Draft an NDA' } });
    assert.equal(second.statusCode, 202, second.body);
    assert.equal(JSON.parse(second.body).id, id1, 'повтор вернул ТО ЖЕ задание');
    const used = await db.query<{ api_requests: number | string }>(
      "SELECT api_requests FROM usage_counters WHERE user_id = $1 AND month = date_trunc('month', now())::date",
      [u.id],
    );
    assert.equal(Number(used.rows[0]?.api_requests), 1, 'юнит списан один раз');
    const jobs = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM api_requests WHERE user_id = $1', [u.id]);
    assert.equal(Number(jobs.rows[0]?.n), 1, 'дубль-задание не создано');
  });

  it('тот же Idempotency-Key на другом эндпоинте — 409; без заголовка дубли создаются', async () => {
    const u = await makeBusinessUser();
    const { key } = await makeKey(u.token);
    const idem = `cross-${Date.now()}`;
    const h = { ...keyAuth(key), 'content-type': 'application/json', 'idempotency-key': idem };
    const draft = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: h, payload: { prompt: 'Draft an NDA' } });
    assert.equal(draft.statusCode, 202, draft.body);
    const cross = await app.inject({ method: 'POST', url: '/api/v1/compares', headers: h, payload: { textA: CONTRACT_TEXT, textB: CONTRACT_TEXT + ' Extra clause.' } });
    assert.equal(cross.statusCode, 409, cross.body);
    assert.equal(JSON.parse(cross.body).error.code, 'idempotency_key_reused');
    // Слишком длинный ключ — 400.
    const long = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(key), 'content-type': 'application/json', 'idempotency-key': 'x'.repeat(300) }, payload: { prompt: 'Draft' } });
    assert.equal(long.statusCode, 400, long.body);
    // Без заголовка два POST создают два задания (идемпотентность opt-in).
    const p1 = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { prompt: 'Draft a lease' } });
    const p2 = await app.inject({ method: 'POST', url: '/api/v1/drafts', headers: { ...keyAuth(key), 'content-type': 'application/json' }, payload: { prompt: 'Draft a lease' } });
    assert.notEqual(JSON.parse(p1.body).id, JSON.parse(p2.body).id);
  });

  it('OpenAPI-спека публична и описывает все /v1-пути', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    assert.equal(res.statusCode, 200, res.body);
    const spec = JSON.parse(res.body);
    assert.equal(spec.openapi, '3.1.0');
    for (const p of ['/v1/analyses', '/v1/drafts', '/v1/compares', '/v1/templates', '/v1/webhooks', '/v1/usage']) {
      assert.ok(spec.paths[p], `путь ${p} описан`);
    }
    // Секретов в спеке нет, а ключ для её чтения не нужен.
    assert.ok(!res.body.includes('lxb_secret') && !res.body.includes('signing_secret_enc'));
  });

  it('ретеншен: строки api_idempotency старше 7 дней чистятся', async () => {
    const u = await makeBusinessUser();
    await db.query(
      "INSERT INTO api_idempotency (user_id, idem_hash, kind, request_id, created_at) VALUES ($1, 'oldhash', 'draft', 'apireq_gone', now() - interval '8 days')",
      [u.id],
    );
    await pruneApiRequests(db);
    const left = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM api_idempotency WHERE user_id = $1', [u.id]);
    assert.equal(Number(left.rows[0]?.n), 0, 'старые идемпотентные ключи вычищены');
  });
});
