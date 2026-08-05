/**
 * Э-подписи закрыты по умолчанию (до подключения E-IMZO): отправка на подпись
 * отвечает 503, а интерфейс узнаёт об этом из /billing/limits.features.esign.
 * Отдельный процесс node:test — без ESIGN_ENABLED в окружении.
 *
 * Смысл теста: подпись через песочницу провайдера юридически ничтожна, и
 * прежний дефолт (песочница + молчаливый интерфейс) выдавал такие документы
 * за настоящие. Дефолт обязан оставаться закрытым.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-noesign-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'noesign-test-master-key-0123456789abcdef';
process.env.SEED_DEMO_DATA = 'false';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.BILLING_FALLBACK = 'dev';
for (const k of Object.keys(process.env)) if (k.startsWith('LEMONSQUEEZY_')) delete process.env[k];
delete process.env.ESIGN_ENABLED;

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
  const email = `es${Date.now()}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: row.rows[0].verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
  return { id: row.rows[0].id, token: JSON.parse(login.body).token };
}

describe('e-signatures are closed until E-IMZO', () => {
  it('POST /signatures → 503, запрос на подпись не создаётся', async () => {
    const u = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Pro' WHERE user_id = $1", [u.id]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/signatures',
      headers: { authorization: `Bearer ${u.token}` },
      payload: { documentName: 'any.pdf', recipients: [{ name: 'A', email: 'a@ext.example' }] },
    });
    assert.equal(res.statusCode, 503, res.body);
    const rows = await db.query<{ count: string | number }>('SELECT count(*) AS count FROM signature_requests WHERE user_id = $1', [u.id]);
    assert.equal(Number(rows.rows[0]?.count ?? 0), 0);
  });

  it('/billing/limits сообщает интерфейсу, что раздел закрыт', async () => {
    const u = await makeUser();
    const res = await app.inject({ method: 'GET', url: '/api/billing/limits', headers: { authorization: `Bearer ${u.token}` } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).features.esign, false);
  });
});
