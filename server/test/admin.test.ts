/**
 * Админ-панель: выдача тарифов и персональных лимитов.
 *
 * Две вещи, ради которых этот файл существует:
 *  1. ЧУЖОЙ НЕ ДОЛЖЕН ПОПАСТЬ. Панель выдаёт платные тарифы и снимает лимиты —
 *     дыра здесь дороже любой другой в продукте. Проверяем каждый маршрут от
 *     лица обычного пользователя, а не только «страница скрыта».
 *  2. ВЫДАННЫЕ ЛИМИТЫ ДОЛЖНЫ РЕАЛЬНО ПРИМЕНЯТЬСЯ. Записать число в таблицу мало
 *     — гейт обязан считать по нему, иначе «выдал 3000 документов» окажется
 *     красивой строчкой в интерфейсе и отказом в работе у клиента.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN_EMAIL = 'owner@lexabai.com';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-admin-test-'));
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'admin-test-master-key-0123456789abcdefgh';
process.env.SEED_DEMO_DATA = 'false';
process.env.ADMIN_EMAILS = `  ${ADMIN_EMAIL.toUpperCase()} , spare@example.com `; // регистр и пробелы не важны
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.LLM_FALLBACK = 'dev';

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');
const { effectiveLimits, planFor, assertDocumentAllowance, reserveAiRequest } = await import('../src/lib/limits.ts');

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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let n = 0;
async function makeUser(email?: string): Promise<{ id: string; token: string; email: string }> {
  const mail = email ?? `adm${++n}.${Date.now()}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email: mail, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [mail]);
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: row.rows[0].verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: mail, password: 'Passw0rd!123' } });
  return { id: row.rows[0].id, token: JSON.parse(login.body).token, email: mail };
}

let admin: { id: string; token: string; email: string };
let client: { id: string; token: string; email: string };

before(async () => {
  admin = await makeUser(ADMIN_EMAIL);
  client = await makeUser();
});

describe('доступ в админ-панель', () => {
  const ROUTES: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: (id: string) => string; payload?: unknown }[] = [
    { method: 'GET', url: () => '/api/admin/whoami' },
    { method: 'GET', url: () => '/api/admin/stats' },
    { method: 'GET', url: () => '/api/admin/users?q=' },
    { method: 'GET', url: (id) => `/api/admin/users/${id}` },
    { method: 'POST', url: (id) => `/api/admin/users/${id}/plan`, payload: { plan: 'Business' } },
    { method: 'PUT', url: (id) => `/api/admin/users/${id}/limits`, payload: { ai: 999999 } },
    { method: 'DELETE', url: (id) => `/api/admin/users/${id}/limits` },
    { method: 'POST', url: (id) => `/api/admin/users/${id}/usage/reset`, payload: {} },
  ];

  it('обычный пользователь не проходит НИ НА ОДИН маршрут', async () => {
    for (const r of ROUTES) {
      const res = await app.inject({ method: r.method, url: r.url(client.id), headers: auth(client.token), payload: r.payload });
      assert.equal(res.statusCode, 404, `${r.method} ${r.url(client.id)} → ${res.statusCode}`);
    }
    // И тариф от этих попыток не изменился.
    assert.equal(await planFor(db, client.id), 'Free');
  });

  it('без токена — тоже мимо', async () => {
    for (const r of ROUTES) {
      const res = await app.inject({ method: r.method, url: r.url(client.id), payload: r.payload });
      assert.ok(res.statusCode === 401 || res.statusCode === 404, `${r.method} → ${res.statusCode}`);
    }
  });

  it('владелец проходит', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/whoami', headers: auth(admin.token) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).admin, true);
  });
});

describe('выдача тарифа', () => {
  it('владелец выдаёт Business на 3 месяца — тариф и срок применяются', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${client.id}/plan`,
      headers: auth(admin.token),
      payload: { plan: 'Business', months: 3, note: 'оплатил переводом' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.plan, 'Business');
    assert.ok(body.renewsAt, 'срок проставлен');
    const days = (new Date(body.renewsAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 80 && days < 95, `срок ≈ 3 месяца, получено ${Math.round(days)} дн.`);
    assert.equal(await planFor(db, client.id), 'Business');

    const row = await db.query<{ source: string; granted_by: string; grant_note: string }>(
      'SELECT source, granted_by, grant_note FROM subscriptions WHERE user_id = $1',
      [client.id],
    );
    assert.equal(row.rows[0].source, 'manual');
    assert.equal(row.rows[0].granted_by, ADMIN_EMAIL);
    assert.equal(row.rows[0].grant_note, 'оплатил переводом');
  });

  it('выдача Free = отзыв доступа', async () => {
    const victim = await makeUser();
    await app.inject({ method: 'POST', url: `/api/admin/users/${victim.id}/plan`, headers: auth(admin.token), payload: { plan: 'Pro' } });
    assert.equal(await planFor(db, victim.id), 'Pro');
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${victim.id}/plan`, headers: auth(admin.token), payload: { plan: 'Free' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await planFor(db, victim.id), 'Free');
  });

  it('несуществующий тариф и битая дата отклоняются', async () => {
    const bad = await app.inject({ method: 'POST', url: `/api/admin/users/${client.id}/plan`, headers: auth(admin.token), payload: { plan: 'Platinum' } });
    assert.equal(bad.statusCode, 400);
    const past = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${client.id}/plan`,
      headers: auth(admin.token),
      payload: { plan: 'Pro', until: '2001-01-01' },
    });
    assert.equal(past.statusCode, 400, 'дата в прошлом отклонена');
  });

  it('неизвестный пользователь → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/nope/plan', headers: auth(admin.token), payload: { plan: 'Pro' } });
    assert.equal(res.statusCode, 404);
  });
});

describe('персональные лимиты', () => {
  it('БОЛЬШЕ тарифного: 3000 документов на Business — и гейт считает по ним', async () => {
    await app.inject({ method: 'POST', url: `/api/admin/users/${client.id}/plan`, headers: auth(admin.token), payload: { plan: 'Business' } });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${client.id}/limits`,
      headers: auth(admin.token),
      payload: { docs: 3000, note: 'договорились на 3000' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).limits.docs, 3000);

    // Расход выше тарифных 500, но ниже выданных 3000 — работа не блокируется.
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
       VALUES ($1, date_trunc('month', now())::date, 0, 900)
       ON CONFLICT (user_id, month) DO UPDATE SET docs_created = 900`,
      [client.id],
    );
    await assertDocumentAllowance(db, client.id); // не бросает
  });

  it('МЕНЬШЕ тарифного: урезанный ИИ действительно упирается', async () => {
    const tight = await makeUser();
    await app.inject({ method: 'POST', url: `/api/admin/users/${tight.id}/plan`, headers: auth(admin.token), payload: { plan: 'Business' } });
    await app.inject({ method: 'PUT', url: `/api/admin/users/${tight.id}/limits`, headers: auth(admin.token), payload: { ai: 2 } });
    await reserveAiRequest(db, tight.id);
    await reserveAiRequest(db, tight.id);
    await assert.rejects(() => reserveAiRequest(db, tight.id), /Лимит ИИ-запросов/);
  });

  it('«unlimited» снимает потолок, null возвращает тарифный', async () => {
    const u = await makeUser();
    await app.inject({ method: 'POST', url: `/api/admin/users/${u.id}/plan`, headers: auth(admin.token), payload: { plan: 'Standard' } });

    await app.inject({ method: 'PUT', url: `/api/admin/users/${u.id}/limits`, headers: auth(admin.token), payload: { ai: 'unlimited' } });
    assert.equal((await effectiveLimits(db, u.id, 'Standard')).ai, null, 'без ограничения');

    await app.inject({ method: 'PUT', url: `/api/admin/users/${u.id}/limits`, headers: auth(admin.token), payload: { ai: null } });
    assert.equal((await effectiveLimits(db, u.id, 'Standard')).ai, 100, 'вернулись к тарифу Standard');
  });

  it('сброс всех персональных лимитов возвращает тарифные', async () => {
    const u = await makeUser();
    await app.inject({ method: 'POST', url: `/api/admin/users/${u.id}/plan`, headers: auth(admin.token), payload: { plan: 'Pro' } });
    await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${u.id}/limits`,
      headers: auth(admin.token),
      payload: { ai: 1, docs: 2, storageMb: 3, seats: 4, apiMonthly: 5 },
    });
    const before = await effectiveLimits(db, u.id, 'Pro');
    assert.deepEqual([before.ai, before.docs, before.storageMb, before.seats, before.apiMonthly], [1, 2, 3, 4, 5]);

    const res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${u.id}/limits`, headers: auth(admin.token) });
    assert.equal(res.statusCode, 200, res.body);
    const after = await effectiveLimits(db, u.id, 'Pro');
    assert.deepEqual([after.ai, after.docs, after.storageMb, after.seats], [500, 80, 500, 1], 'тарифные значения Pro');
    assert.deepEqual(after.overridden, []);
    const left = await db.query('SELECT 1 FROM user_limit_overrides WHERE user_id = $1', [u.id]);
    assert.equal(left.rows.length, 0, 'пустая строка переопределений удалена');
  });

  it('мусор в значении лимита отклоняется', async () => {
    for (const payload of [{ ai: -5 }, { docs: 1.5 }, { seats: 'много' }, {}]) {
      const res = await app.inject({ method: 'PUT', url: `/api/admin/users/${client.id}/limits`, headers: auth(admin.token), payload });
      assert.equal(res.statusCode, 400, `${JSON.stringify(payload)} → ${res.statusCode}`);
    }
  });

  it('клиент видит свои действующие лимиты, включая персональные', async () => {
    const u = await makeUser();
    await app.inject({ method: 'POST', url: `/api/admin/users/${u.id}/plan`, headers: auth(admin.token), payload: { plan: 'Standard' } });
    await app.inject({ method: 'PUT', url: `/api/admin/users/${u.id}/limits`, headers: auth(admin.token), payload: { docs: 777 } });
    const res = await app.inject({ method: 'GET', url: '/api/billing/limits', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.documents.limit, 777);
    assert.deepEqual(body.customLimits, ['docs']);
  });
});

describe('обнуление расхода', () => {
  it('счётчики месяца сбрасываются', async () => {
    const u = await makeUser();
    await reserveAiRequest(db, u.id);
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${u.id}/usage/reset`, headers: auth(admin.token), payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).usage.aiRequests, 0);
  });
});

describe('карточка аккаунта', () => {
  it('показывает и тарифные, и действующие лимиты, и историю выдач', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/users/${client.id}`, headers: auth(admin.token) });
    assert.equal(res.statusCode, 200, res.body);
    const b = JSON.parse(res.body);
    assert.equal(b.user.email, client.email);
    assert.equal(b.subscription.plan, 'Business');
    assert.equal(b.planLimits.docs, 500, 'что даёт тариф');
    assert.equal(b.limits.docs, 3000, 'что реально применяется');
    assert.ok(b.history.some((h: { kind: string }) => h.kind === 'granted'), 'история выдач видна');
  });
});
