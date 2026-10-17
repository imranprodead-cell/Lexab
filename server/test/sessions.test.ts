/**
 * «Активные сессии»: одно устройство — одна запись (2026-10-17).
 *
 * Было: каждый вход писал новую строку, повторный вход с того же браузера
 * старую не трогал, а мёртвые сессии висели до 90 дней — одно устройство
 * показывалось десятком строк.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-sessions-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'sessions-test-master-key-0123456789abcdef!';
process.env.SEED_DEMO_DATA = 'false';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.AUTH_LOCKOUT_FAILURES = '100000';
process.env.BATCH_AUTOSTART = '0';
for (const k of Object.keys(process.env)) if (k.startsWith('LEMONSQUEEZY_')) delete process.env[k];

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');
const { groupSessionsByDevice, pruneStaleSessions, tokenLifetimeDays } = await import('../src/routes/security.routes.ts');

const db = await getDb();
await migrate(db);
const app = await buildApp(db);
await app.ready();

after(async () => {
  await app.close();
  await db.close();
  fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
});

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';
const PASSWORD = 'Passw0rd!123';
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let counter = 0;
/** Зарегистрирован и подтверждён; подтверждение — вход без номера устройства (как раньше). */
async function makeUser(): Promise<{ id: string; email: string }> {
  const email = `sess${Date.now()}_${counter++}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: PASSWORD } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  await app.inject({ method: 'POST', url: '/api/auth/verify', headers: { 'user-agent': MAC }, payload: { token: row.rows[0].verify_token } });
  return { id: row.rows[0].id, email };
}

async function login(email: string, ua: string, deviceId?: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'user-agent': ua },
    payload: { email, password: PASSWORD, ...(deviceId ? { deviceId } : {}) },
  });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body).token;
}

const list = async (token: string) => {
  const res = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: auth(token) });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body) as { userAgent: string; current: boolean; sessions: number }[];
};
const rowCount = async (userId: string) =>
  Number((await db.query<{ n: string | number }>('SELECT count(*) AS n FROM user_sessions WHERE user_id = $1', [userId])).rows[0].n);

describe('активные сессии: одно устройство — одна запись', () => {
  it('повторный вход с того же браузера заменяет его сессию, а не добавляет новую', async () => {
    const u = await makeUser();
    const first = await login(u.email, MAC, 'mac-browser-0001');
    const second = await login(u.email, MAC, 'mac-browser-0001');
    const third = await login(u.email, MAC, 'mac-browser-0001');
    const rows = await db.query<{ n: string | number }>(
      "SELECT count(*) AS n FROM user_sessions WHERE user_id = $1 AND device_id = 'mac-browser-0001'",
      [u.id],
    );
    assert.equal(Number(rows.rows[0].n), 1, 'у браузера ровно одна сессия');
    // Прежний токен этого браузера отозван вместе со строкой.
    const old = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: auth(first) });
    assert.equal(old.statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/me/sessions', headers: auth(second) })).statusCode, 401);
    // Старый вход того же браузера без номера (подтверждение почты) приклеен к нему.
    const sessions = await list(third);
    assert.equal(sessions.length, 1, JSON.stringify(sessions));
    assert.equal(sessions[0].current, true);
  });

  it('разные устройства — разные записи, текущее первым', async () => {
    const u = await makeUser();
    const mac = await login(u.email, MAC, 'mac-browser-0002');
    const phone = await login(u.email, IPHONE, 'iphone-browser-0002');
    const fromPhone = await list(phone);
    assert.equal(fromPhone.length, 2);
    assert.equal(fromPhone[0].userAgent, IPHONE, 'текущее устройство первым');
    assert.equal(fromPhone[0].current, true);
    assert.equal(fromPhone[1].current, false);
    const fromMac = await list(mac);
    assert.equal(fromMac[0].userAgent, MAC);
  });

  it('старые входы без номера с одной строкой браузера склеиваются', () => {
    const at = (days: number) => new Date(Date.now() - days * 86_400_000);
    const view = groupSessionsByDevice(
      [
        { id: 's1', ip: '1.1.1.1', user_agent: IPHONE, device_id: null, created_at: at(16), last_seen_at: at(16) },
        { id: 's2', ip: '1.1.1.2', user_agent: IPHONE, device_id: null, created_at: at(16), last_seen_at: at(16) },
        { id: 's3', ip: '2.2.2.2', user_agent: MAC, device_id: null, created_at: at(13), last_seen_at: at(13) },
        { id: 's4', ip: '127.0.0.1', user_agent: MAC, device_id: 'mac-local', created_at: at(0), last_seen_at: at(0) },
      ],
      's4',
    );
    assert.equal(view.length, 2);
    assert.deepEqual(
      view.map((v) => [v.userAgent, v.sessions, v.current]),
      [
        [MAC, 2, true],
        [IPHONE, 2, false],
      ],
    );
  });

  it('мёртвая сессия (не продлевалась дольше срока токена) не показывается и вычищается', async () => {
    const u = await makeUser();
    const mac = await login(u.email, MAC, 'mac-browser-0003');
    await login(u.email, IPHONE, 'iphone-browser-0003');
    await db.query(
      `UPDATE user_sessions SET last_seen_at = now() - interval '40 days' WHERE user_id = $1 AND device_id = 'iphone-browser-0003'`,
      [u.id],
    );
    const sessions = await list(mac);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].userAgent, MAC);
    await pruneStaleSessions(db);
    const left = await db.query<{ device_id: string | null }>('SELECT device_id FROM user_sessions WHERE user_id = $1', [u.id]);
    assert.ok(!left.rows.some((r) => r.device_id === 'iphone-browser-0003'), 'мёртвая строка удалена');
  });

  it('смена пароля убирает записи разлогиненных устройств', async () => {
    const u = await makeUser();
    const mac = await login(u.email, MAC, 'mac-browser-0004');
    await login(u.email, IPHONE, 'iphone-browser-0004');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { ...auth(mac), 'user-agent': MAC },
      payload: { currentPassword: PASSWORD, newPassword: 'N3w-Passw0rd!456', deviceId: 'mac-browser-0004' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await rowCount(u.id), 1, 'осталась только сессия, сменившая пароль');
    const sessions = await list(JSON.parse(res.body).token);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].current, true);
  });

  it('срок жизни токена читается из JWT_EXPIRES_IN', () => {
    assert.equal(tokenLifetimeDays('30d'), 30);
    assert.equal(tokenLifetimeDays('12h'), 1);
    assert.equal(tokenLifetimeDays('172800'), 2);
    assert.equal(tokenLifetimeDays('что-то'), 30);
  });
});
