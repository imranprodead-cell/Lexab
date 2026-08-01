/**
 * Биллинг БЕЗ платёжного провайдера и БЕЗ dev-фолбэка: прод, где забыли (или
 * ещё не успели) настроить Lemon Squeezy, НЕ должен раздавать платные планы
 * бесплатно. Отдельный процесс node:test — env без LEMONSQUEEZY_* и без
 * BILLING_FALLBACK.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-nobilling-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'nobilling-test-master-key-0123456789abcd';
process.env.SEED_DEMO_DATA = 'false';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
// Ни LEMONSQUEEZY_*, ни BILLING_FALLBACK — и амбиентные значения из shell
// зануляем явно, иначе экспортированный конфиг разработчика ломает смысл сьюта.
for (const k of Object.keys(process.env)) if (k.startsWith('LEMONSQUEEZY_')) delete process.env[k];
delete process.env.BILLING_FALLBACK;

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');

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

async function makeUser(): Promise<{ token: string; id: string }> {
  const email = `nb${Date.now()}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: row.rows[0].verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
  return { id: row.rows[0].id, token: JSON.parse(login.body).token };
}

describe('billing without provider and without dev fallback', () => {
  it('checkout → 503, план не выдан', async () => {
    const u = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers: { authorization: `Bearer ${u.token}` },
      payload: { plan: 'Pro', period: 'monthly', consent: true },
    });
    assert.equal(res.statusCode, 503, res.body);
    const row = await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [u.id]);
    assert.equal(row.rows[0]?.plan ?? 'Free', 'Free');
  });

  it('вебхук LS без конфига → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'x-signature': 'aa' },
    });
    assert.equal(res.statusCode, 404);
  });
});
