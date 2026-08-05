/**
 * Брутфорс входа: после серии неудачных попыток вход временно закрывается.
 *
 * До аудита 2026-08-03 детектор только слал письмо владельцу, но перебору не
 * мешал, а бакет rate-limit отвязывался от IP простым добавлением своего JWT.
 * Здесь проверяются оба контура: блокировка по счётчику неудач и то, что
 * посторонний Authorization-заголовок не даёт отдельный бюджет попыток.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-lockout-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'lockout-test-master-key-0123456789abcdef';
process.env.SEED_DEMO_DATA = 'false';
process.env.PASSWORD_BREACH_CHECK = '0';
// Лимит запросов в минуту поднят: проверяем именно блокировку по неудачам,
// а не 429 от общего rate-limit.
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.AUTH_LOCKOUT_FAILURES = '5';
for (const k of Object.keys(process.env)) if (k.startsWith('LEMONSQUEEZY_')) delete process.env[k];

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

const PASSWORD = 'Passw0rd!123';

async function makeUser(email: string): Promise<void> {
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: PASSWORD } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ verify_token: string }>('SELECT verify_token FROM users WHERE email = $1', [email]);
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: row.rows[0].verify_token } });
}

describe('login lockout', () => {
  it('5 неудач → вход закрывается даже с ВЕРНЫМ паролем', async () => {
    const email = 'lockout-a@test.local';
    await makeUser(email);

    for (let i = 0; i < 5; i++) {
      const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' } });
      assert.equal(bad.statusCode, 401, `попытка ${i + 1}: ${bad.body}`);
    }

    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(locked.statusCode, 429, locked.body);
    assert.equal(JSON.parse(locked.body).code, 'locked_out');
  });

  it('свой JWT не даёт отдельный бюджет попыток, а сосед по IP не заперт', async () => {
    const victim = 'lockout-b@test.local';
    const attacker = 'lockout-c@test.local';
    await makeUser(victim);
    await makeUser(attacker);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: attacker, password: PASSWORD } });
    assert.equal(login.statusCode, 200, login.body);
    const token = JSON.parse(login.body).token as string;

    // Перебор чужого пароля ПОД СВОИМ токеном — раньше так брутфорс уходил в
    // персональный бакет `u:<id>` и не тратил лимит IP.
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { authorization: `Bearer ${token}` },
        payload: { email: victim, password: 'wrong-password' },
      });
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: victim, password: PASSWORD },
    });
    assert.equal(locked.statusCode, 429, 'перебираемый аккаунт заперт');

    // При этом другой аккаунт с того же IP продолжает входить: порог по адресу
    // в пять раз выше, офис за одним IP не блокируется из-за одного перебора.
    const neighbour = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: attacker, password: PASSWORD } });
    assert.equal(neighbour.statusCode, 200, neighbour.body);
  });
});
