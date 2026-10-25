/**
 * HTTP route tests against an in-memory PGlite database via Fastify `inject()`.
 * No network, no real Anthropic — LLM_FALLBACK=dev makes AI routes return
 * deterministic mock output so the surrounding logic (auth, limits, IDOR) can
 * be exercised end-to-end.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Env must be set BEFORE config is imported (config reads it at load time), so
// everything that touches config is loaded via dynamic import below.
process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = ''; // an ambient key must not make "no network" tests hit the real API
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
// Document encryption ON for the WHOLE route suite: every upload → analysis →
// chat → export flow below exercises encrypt-on-write / decrypt-on-read.
process.env.DATA_ENCRYPTION_KEY = 'routes-test-master-key-0123456789abcdef!';
process.env.SEED_DEMO_DATA = 'false';
// Batch review: drive runBatch() explicitly in tests instead of the route's
// fire-and-forget loop (single-connection PGlite must not race it).
process.env.BATCH_AUTOSTART = '0';
// No network in tests: don't call the HIBP breach API on register/password.
process.env.PASSWORD_BREACH_CHECK = '0';
// Озвучка (POST /tts): валидный по форме ключ сервисного аккаунта, чтобы роут
// был «настроен»; сами вызовы Google перехватываются моком fetch в сьюте tts.
process.env.GOOGLE_TTS_CREDENTIALS_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'tts-test-project',
  client_email: 'tts-test@test.iam.gserviceaccount.com',
  private_key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
});
// Many users register from one loopback IP in this suite — lift the per-minute
// auth cap so the rate limiter (still 10/min in production) doesn't throttle it.
process.env.AUTH_RATE_LIMIT_MAX = '1000';
// Десятки логинов (в т.ч. намеренно неудачных) идут с одного loopback-адреса —
// временная блокировка входа проверяется отдельным процессом: test/lockout.test.ts.
process.env.AUTH_LOCKOUT_FAILURES = '100000';
// Биллинг-тесты этого сьюта написаны под мгновенную активацию (pre-PSP).
// С появлением Lemon Squeezy она живёт только за явным dev-флагом; сам LS
// покрыт отдельным процессом test/lemonsqueezy.test.ts со своим env.
// Амбиентные LEMONSQUEEZY_* из shell зануляем: частичный конфиг валит старт.
process.env.BILLING_FALLBACK = 'dev';
// Раздел э-подписей закрыт по умолчанию (ждём E-IMZO), но сам механизм —
// заморозка текста, ссылки подписантов, сборка подписанного PDF — покрыт этим
// сьютом и должен оставаться рабочим. Проверка «выключено по умолчанию» живёт
// отдельным процессом: test/esign-disabled.test.ts.
process.env.ESIGN_ENABLED = '1';
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

let counter = 0;
/** Register a user, verify their email, and return a bearer token. */
async function makeUser(): Promise<{ email: string; token: string; id: string }> {
  const email = `u${Date.now()}_${counter++}@test.local`;
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

/** A verified user on Pro (includes contract drafting and playbooks). */
async function makeProUser(): Promise<{ email: string; token: string; id: string }> {
  const u = await makeUser();
  await db.query("UPDATE subscriptions SET plan = 'Pro' WHERE user_id = $1", [u.id]);
  return u;
}

describe('security headers', () => {
  it('helmet sets CSP, HSTS, nosniff, frame lock', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-security-policy'] as string, /default-src 'none'/);
    assert.ok(res.headers['strict-transport-security']);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });
});

describe('auth', () => {
  it('register does not issue a session and login is blocked until verified', async () => {
    const email = `pending_${Date.now()}@test.local`;
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'P', email, password: 'Passw0rd!123' } });
    assert.equal(reg.statusCode, 201);
    assert.equal(JSON.parse(reg.body).verifyRequired, true);
    assert.ok(!JSON.parse(reg.body).token);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
    assert.ok(login.statusCode >= 400, 'unverified login must fail');
  });

  it('protected routes require a valid token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    assert.equal(res.statusCode, 401);
  });

  it('refresh exchanges a live token for a working fresh one', async () => {
    const u = await makeUser();
    // iat has 1s resolution — wait past it so a genuinely re-signed token differs.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const { token: fresh, user } = JSON.parse(res.body) as { token: string; user: { email: string } };
    assert.ok(fresh, 'refresh returns a token');
    assert.notEqual(fresh, u.token, 'refresh must mint a NEW token, not echo the old one');
    assert.equal(user.email, u.email);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(fresh) });
    assert.equal(me.statusCode, 200, 'the refreshed token authenticates');
    const old = await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) });
    assert.equal(old.statusCode, 200, 'refresh must not revoke the old token (other open tabs/devices)');
    // The original sign-in time must survive the exchange — it is what caps the chain.
    const claim = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()) as { auth_at: number };
    assert.equal(claim(fresh).auth_at, claim(u.token).auth_at, 'auth_at must carry over unchanged');
  });

  it('refresh is rejected without a token and after logout (revocation)', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    assert.equal(anon.statusCode, 401);

    const u = await makeUser();
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(u.token) });
    // token_version bumped → every previously issued token (incl. this one) is dead.
    const revoked = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: auth(u.token) });
    assert.equal(revoked.statusCode, 401, 'a revoked token must not be refreshable');
  });

  it('refresh refuses a chain whose original sign-in exceeds the absolute cap', async () => {
    const u = await makeUser();
    // Forge what a long-refreshed chain would look like: a VALID token (real
    // token_version) whose auth_at (original sign-in) is 91 days old — past the
    // 90-day default cap. Sanity-check the forgery works before aging it.
    const { tv } = JSON.parse(Buffer.from(u.token.split('.')[1], 'base64url').toString()) as { tv: number };
    const now = Math.floor(Date.now() / 1000);
    const live = app.jwt.sign({ sub: u.id, tv, auth_at: now }, { expiresIn: '30d' });
    const sane = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: auth(live) });
    assert.equal(sane.statusCode, 200, 'control: a forged-but-young token refreshes fine');
    const aged = app.jwt.sign({ sub: u.id, tv, auth_at: now - 91 * 86400 }, { expiresIn: '30d' });
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: auth(aged) });
    assert.equal(res.statusCode, 401, 'a 91-day-old session must re-authenticate, not renew');
  });

  it('refresh refuses an account whose email is no longer verified', async () => {
    const u = await makeUser();
    // E.g. the user changed their address — login demands re-verification, so
    // the silent-renewal path must not keep the session alive around it.
    await db.query('UPDATE users SET email_verified = false WHERE id = $1', [u.id]);
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: auth(u.token) });
    assert.equal(res.statusCode, 401);
  });
});

describe('AI usage reservation (atomic limit)', () => {
  it('разбор договора списывает ДОКУМЕНТЫ и не трогает лимит чата', async () => {
    // Правило владельца 2026-08-06: лимит ИИ-запросов — только переписка в
    // чате. Разбор, сравнение, шаблоны, массовый разбор идут из лимита
    // документов. Тест сторожит именно это разделение.
    const { PLAN_LIMITS } = await import('../src/lib/limits.ts');
    const docsCap = PLAN_LIMITS.Free.docs as number;
    const { token, id } = await makeUser();
    // Подводим счётчик документов вплотную к потолку.
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
       VALUES ($1, date_trunc('month', now())::date, 0, $2)
       ON CONFLICT (user_id, month) DO UPDATE SET ai_requests = 0, docs_created = EXCLUDED.docs_created`,
      [id, docsCap - 1],
    );
    let ok = 0;
    let rejected = 0; // 402 (over limit) или 429 (rate limit) — оба отказ
    // Каждый раз РАЗНОЕ имя → каждый раз новый документ.
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/analysis',
        headers: auth(token),
        payload: { fileName: `burst-${i}.pdf`, fileSize: '10 KB', jurisdiction: 'GB' },
      });
      if (res.statusCode === 201) ok++;
      else if (res.statusCode === 402 || res.statusCode === 429) rejected++;
    }
    assert.equal(ok, 1, 'ровно один разбор помещается под потолок документов');
    assert.equal(rejected, 2, 'остальные отклонены');
    const limits = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/billing/limits', headers: auth(token) })).body,
    );
    assert.equal(limits.documents.used, docsCap, 'счётчик документов не перепрыгнул потолок');
    assert.equal(limits.aiRequests.used, 0, 'лимит чата разбором НЕ тронут');
  });

  it('стоимости операций отдаются клиенту и совпадают с сервером', async () => {
    const { DOC_COST } = await import('../src/lib/limits.ts');
    const { token } = await makeUser();
    const body = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/billing/limits', headers: auth(token) })).body,
    );
    assert.deepEqual(body.docCosts, { analysis: DOC_COST.analysis, draft: DOC_COST.draft, compare: DOC_COST.compare });
    assert.equal(body.docCosts.compare, 5, 'сравнение версий — 5 единиц');
    assert.equal(body.docCosts.draft, 2, 'создание договора — 2 единицы');
  });

  it('reserveAiRequest атомарен: параллельные резервы не перепрыгивают потолок', async () => {
    const { reserveAiRequest, PLAN_LIMITS } = await import('../src/lib/limits.ts');
    const cap = PLAN_LIMITS.Free.ai as number;
    const { id } = await makeUser();
    // Fire concurrently — the check-then-increment must not let more than the cap through.
    const outcomes = await Promise.all(
      Array.from({ length: cap + 2 }, () => reserveAiRequest(db, id).then(() => 'ok').catch(() => 'denied')),
    );
    assert.equal(outcomes.filter((o) => o === 'ok').length, cap);
    assert.equal(outcomes.filter((o) => o === 'denied').length, 2);
  });

  it('квота документов НЕ обходится одинаковым именем файла', async () => {
    // Раньше строка documents искалась по имени, и «Договор.pdf» можно было
    // загружать бесконечно разным содержимым, не потратив ни одной единицы.
    const { token, id } = await makeUser();
    const docsCap = 3;
    let created = 0;
    for (let i = 0; i < docsCap + 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/analysis',
        headers: auth(token),
        payload: { fileName: 'Договор.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
      });
      if (res.statusCode === 201) created++;
    }
    assert.equal(created, docsCap, 'после исчерпания месячной квоты новые разборы отклоняются');
    const counter = await db.query<{ docs_created: number | string }>(
      "SELECT docs_created FROM usage_counters WHERE user_id = $1 AND month = date_trunc('month', now())::date",
      [id],
    );
    assert.equal(Number(counter.rows[0].docs_created), docsCap);
  });
});

describe('authorization / IDOR', () => {
  it("a user cannot read another user's analysis", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const created = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(a.token),
      payload: { fileName: 'private.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    assert.equal(created.statusCode, 201);
    const analysisId = JSON.parse(created.body).id;
    const asOwner = await app.inject({ method: 'GET', url: `/api/analysis/${analysisId}`, headers: auth(a.token) });
    assert.equal(asOwner.statusCode, 200);
    const asOther = await app.inject({ method: 'GET', url: `/api/analysis/${analysisId}`, headers: auth(b.token) });
    assert.equal(asOther.statusCode, 404, "another user must not read it");
  });

  it('GET /files/:key requires auth and enforces ownership', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const key = 'k0123456789abcdef__contract.pdf';
    const dir = path.join(process.env.DATA_DIR as string, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, key), Buffer.from('%PDF-1.4 test bytes'));
    await db.query(
      `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
       VALUES ($1, $2, $3, $4, $5, 'local', $6, $7, $8)`,
      ['up_filetest', owner.id, 'contract.pdf', 19, 'application/pdf', key, `/api/files/${key}`, 'x'],
    );

    const anon = await app.inject({ method: 'GET', url: `/api/files/${key}` });
    assert.equal(anon.statusCode, 401, 'no token → 401');
    const foreign = await app.inject({ method: 'GET', url: `/api/files/${key}`, headers: auth(other.token) });
    assert.equal(foreign.statusCode, 404, "another user must not download it");
    const asOwner = await app.inject({ method: 'GET', url: `/api/files/${key}`, headers: auth(owner.token) });
    assert.equal(asOwner.statusCode, 200, asOwner.body);
  });
});

describe('login does not disclose which emails have accounts', () => {
  it('unknown email and wrong password give the identical 401', async () => {
    const u = await makeUser();
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'definitely-wrong' } });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `ghost_${Date.now()}@test.local`, password: 'definitely-wrong' },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.equal(JSON.parse(wrong.body).message, JSON.parse(unknown.body).message, 'same message → no enumeration');
  });
});

describe('Google one-time login code', () => {
  it('exchanges once, then the code is spent (single-use)', async () => {
    const u = await makeUser();
    const code = `testcode_${Date.now()}_${counter++}`;
    await db.query('INSERT INTO login_codes (code, user_id) VALUES ($1, $2)', [code, u.id]);
    const first = await app.inject({ method: 'POST', url: '/api/auth/google/exchange', payload: { code } });
    assert.equal(first.statusCode, 200, first.body);
    assert.ok(JSON.parse(first.body).token, 'exchange returns a session token');
    const second = await app.inject({ method: 'POST', url: '/api/auth/google/exchange', payload: { code } });
    assert.equal(second.statusCode, 400, 'a spent code must not work again');
  });
});

describe('changing email requires the password AND confirmation on the new address', () => {
  // Раньше хватало живого токена, адрес менялся немедленно, письмо уходило
  // только на новый ящик — украденная сессия давала необратимый захват
  // аккаунта (аудит 2026-08-03). Проверяем весь новый порядок.
  it('без пароля — 401, с паролем адрес лишь ОТЛОЖЕН, применяется по ссылке', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const newEmail = `moved_${Date.now()}_${counter++}@test.local`;

    const noPassword = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(u.token), payload: { email: newEmail } });
    assert.equal(noPassword.statusCode, 401, noPassword.body);
    assert.equal(JSON.parse(noPassword.body).code, 'password_required');

    const wrongPassword = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(u.token),
      payload: { email: newEmail, currentPassword: 'not-my-password' },
    });
    assert.equal(wrongPassword.statusCode, 401, wrongPassword.body);

    const untouched = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [u.id]);
    assert.equal(untouched.rows[0].email, u.email, 'до подтверждения адрес аккаунта не меняется');

    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(u.token),
      payload: { email: newEmail, currentPassword: 'Passw0rd!123' },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    const pending = await db.query<{ email: string; pending_email: string; pending_email_token: string }>(
      'SELECT email, pending_email, pending_email_token FROM users WHERE id = $1',
      [u.id],
    );
    assert.equal(pending.rows[0].email, u.email, 'вход по старому адресу продолжает работать');
    assert.equal(pending.rows[0].pending_email, newEmail);

    // Ссылка из письма применяет адрес и обнуляет ВСЕ сессии, включая чужую.
    const confirm = await app.inject({ method: 'POST', url: '/api/auth/confirm-email', payload: { token: pending.rows[0].pending_email_token } });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const after = await db.query<{ email: string; email_verified: boolean; pending_email: string | null }>(
      'SELECT email, email_verified, pending_email FROM users WHERE id = $1',
      [u.id],
    );
    assert.equal(after.rows[0].email, newEmail);
    assert.equal(after.rows[0].email_verified, true);
    assert.equal(after.rows[0].pending_email, null);
    const oldSession = await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) });
    assert.equal(oldSession.statusCode, 401, 'после смены адреса старые сессии недействительны');

    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: newEmail, password: 'Passw0rd!123' } });
    assert.equal(relogin.statusCode, 200, relogin.body);
    const clash = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(JSON.parse(relogin.body).token),
      payload: { email: other.email, currentPassword: 'Passw0rd!123' },
    });
    assert.equal(clash.statusCode, 409, 'cannot take another account\'s email');
  });
});

describe('registration does not reveal whether an email exists', () => {
  it('a duplicate registration responds like a fresh one (no 409, no second account)', async () => {
    const email = `dup_${Date.now()}_${counter++}@test.local`;
    const first = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'A', email, password: 'Passw0rd!123' } });
    assert.equal(first.statusCode, 201, first.body);
    const second = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'B', email, password: 'Passw0rd!123' } });
    assert.equal(second.statusCode, 201, 'a duplicate must not return 409 — that would be an existence oracle');
    const rows = await db.query<{ c: string | number }>('SELECT count(*) AS c FROM users WHERE lower(email) = lower($1)', [email]);
    assert.equal(Number(rows.rows[0].c), 1, 'no duplicate account is created');
  });
});

describe('feedback validation', () => {
  it('rejects an unknown category and a prototype key, accepts a valid one', async () => {
    const { token } = await makeUser();
    const bad = await app.inject({ method: 'POST', url: '/api/feedback', headers: auth(token), payload: { message: 'hello there', category: 'hack' } });
    assert.equal(bad.statusCode, 400);
    const proto = await app.inject({ method: 'POST', url: '/api/feedback', headers: auth(token), payload: { message: 'hello there', category: '__proto__' } });
    assert.equal(proto.statusCode, 400, 'prototype key must not bypass the allowlist');
    const good = await app.inject({ method: 'POST', url: '/api/feedback', headers: auth(token), payload: { message: 'hello there', category: 'legal' } });
    assert.equal(good.statusCode, 204);
  });
});

describe('prompt improver', () => {
  it('requires a real session (401 anonymous)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/prompts/improve', payload: { text: 'помоги с договором' } });
    assert.equal(res.statusCode, 401);
  });

  it('validates the text field', async () => {
    const { token } = await makeUser();
    const missing = await app.inject({ method: 'POST', url: '/api/prompts/improve', headers: auth(token), payload: {} });
    assert.equal(missing.statusCode, 400);
    const short = await app.inject({ method: 'POST', url: '/api/prompts/improve', headers: auth(token), payload: { text: 'ab' } });
    assert.equal(short.statusCode, 400);
    const long = await app.inject({ method: 'POST', url: '/api/prompts/improve', headers: auth(token), payload: { text: 'x'.repeat(4001) } });
    assert.equal(long.statusCode, 400);
    const fewWords = await app.inject({ method: 'POST', url: '/api/prompts/improve', headers: auth(token), payload: { text: 'проверь мой договор аренды' } });
    assert.equal(fewWords.statusCode, 400, 'under 5 words there is nothing to improve');
  });

  it('returns the rewritten prompt (deterministic dev fallback)', async () => {
    const { token } = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/prompts/improve',
      headers: auth(token),
      payload: { text: 'проверь договор аренды на скрытые риски' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).text, '[dev] проверь договор аренды на скрытые риски');
  });
});

describe('saved documents (saved from chat, Vault → Documents)', () => {
  it('saves, lists, isolates per user, and deletes', async () => {
    const a = await makeUser();
    const b = await makeUser();

    const save = await app.inject({
      method: 'POST',
      url: '/api/templates/saved',
      headers: auth(a.token),
      payload: { title: 'My NDA', content: 'NDA BODY TEXT', sourceTemplateId: 't1', jurisdiction: 'English law' },
    });
    assert.equal(save.statusCode, 201, save.body);
    const saved = JSON.parse(save.body);
    assert.equal(saved.content, 'NDA BODY TEXT');
    assert.ok(saved.id);

    const list = await app.inject({ method: 'GET', url: '/api/templates/saved', headers: auth(a.token) });
    assert.equal(JSON.parse(list.body).length, 1);

    // Isolation: another user sees none and cannot delete someone else's.
    const otherList = await app.inject({ method: 'GET', url: '/api/templates/saved', headers: auth(b.token) });
    assert.equal(JSON.parse(otherList.body).length, 0, 'saved templates must be per-user');
    const crossDelete = await app.inject({ method: 'DELETE', url: `/api/templates/saved/${saved.id}`, headers: auth(b.token) });
    assert.equal(crossDelete.statusCode, 404, 'a foreign id must not delete');

    const del = await app.inject({ method: 'DELETE', url: `/api/templates/saved/${saved.id}`, headers: auth(a.token) });
    assert.equal(del.statusCode, 204);
    const after = await app.inject({ method: 'GET', url: '/api/templates/saved', headers: auth(a.token) });
    assert.equal(JSON.parse(after.body).length, 0);
  });

  // «Недавние файлы» в новом чате берут только последние N черновиков.
  it('limits the list to the newest N with ?limit=', async () => {
    const { token } = await makeUser();
    for (const title of ['First', 'Second', 'Third']) {
      const r = await app.inject({ method: 'POST', url: '/api/templates/saved', headers: auth(token), payload: { title, content: 'body' } });
      assert.equal(r.statusCode, 201, r.body);
    }
    const two = await app.inject({ method: 'GET', url: '/api/templates/saved?limit=2', headers: auth(token) });
    assert.equal(two.statusCode, 200, two.body);
    assert.equal(JSON.parse(two.body).length, 2);
    // Мусор вместо числа — как без параметра: весь список.
    const junk = await app.inject({ method: 'GET', url: '/api/templates/saved?limit=abc', headers: auth(token) });
    assert.equal(JSON.parse(junk.body).length, 3);
    const zero = await app.inject({ method: 'GET', url: '/api/templates/saved?limit=0', headers: auth(token) });
    assert.equal(JSON.parse(zero.body).length, 3);
  });

  it('rejects an empty title', async () => {
    const { token } = await makeUser();
    const res = await app.inject({ method: 'POST', url: '/api/templates/saved', headers: auth(token), payload: { title: '', content: 'x' } });
    assert.equal(res.statusCode, 400);
  });

  // Правки из воркспейса шаблонов: PATCH обновляет текст, чужой id — 404.
  it('updates saved content via PATCH and enforces ownership', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const save = await app.inject({
      method: 'POST',
      url: '/api/templates/saved',
      headers: auth(a.token),
      payload: { title: 'Services Agreement', content: 'OLD BODY' },
    });
    const saved = JSON.parse(save.body);

    const crossPatch = await app.inject({
      method: 'PATCH',
      url: `/api/templates/saved/${saved.id}`,
      headers: auth(b.token),
      payload: { content: 'HIJACKED' },
    });
    assert.equal(crossPatch.statusCode, 404, 'a foreign id must not update');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/templates/saved/${saved.id}`,
      headers: auth(a.token),
      payload: { content: 'NEW EDITED BODY' },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    assert.equal(JSON.parse(patch.body).content, 'NEW EDITED BODY');

    // The list round-trips the edited text (decrypted from at-rest ciphertext).
    const list = await app.inject({ method: 'GET', url: '/api/templates/saved', headers: auth(a.token) });
    assert.equal(JSON.parse(list.body)[0].content, 'NEW EDITED BODY');

    const empty = await app.inject({
      method: 'PATCH',
      url: `/api/templates/saved/${saved.id}`,
      headers: auth(a.token),
      payload: { content: '' },
    });
    assert.equal(empty.statusCode, 400, 'blank content must be rejected');
  });

  // Каталог шаблонов и генерация по шаблону сняты 2026-10-25; готовые наборы
  // плейбуков — тоже. Сохранённые документы при этом работают (тесты выше).
  it('template catalog, template generator and playbook packs are gone (404)', async () => {
    const { token } = await makeProUser();
    for (const [method, url] of [
      ['GET', '/api/templates'],
      ['POST', '/api/templates/t9/generate'],
      ['GET', '/api/playbooks/packs'],
      ['POST', '/api/playbooks/packs/uk-nda/install'],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(token), payload: method === 'POST' ? {} : undefined });
      assert.equal(res.statusCode, 404, `${method} ${url} → ${res.statusCode}`);
    }
  });
});

describe('contract draft (chat → editable sheet)', () => {
  it('generates a block document, persists it, and stays editable', async () => {
    const { token } = await makeProUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/draft',
      headers: auth(token),
      payload: { prompt: 'Consulting agreement between Acme and Beta for 6 months', jurisdiction: 'English law' },
    });
    assert.equal(res.statusCode, 201, res.body);
    const an = JSON.parse(res.body);
    assert.ok(an.id, 'draft persisted with an id');
    assert.ok(Array.isArray(an.document) && an.document.length >= 4, 'draft has document blocks');
    assert.ok(an.document.some((x: { type: string }) => x.type === 'heading'), 'has headings');
    assert.ok(an.document.some((x: { type: string }) => x.type === 'paragraph'), 'has paragraphs');
    assert.equal(an.findings.length, 0, 'a clean draft has no findings');
    assert.equal(an.redlines.length, 0, 'a clean draft has no redlines');
    assert.ok(typeof an.summary === 'string' && an.summary.length > 0);

    // Editable in the workspace: PATCH the document, then read it back.
    const edited = [
      { type: 'heading', text: '1.  Edited by hand' },
      { type: 'paragraph', segments: ['Replaced clause text.'] },
    ];
    const patch = await app.inject({ method: 'PATCH', url: `/api/analysis/${an.id}/document`, headers: auth(token), payload: { document: edited } });
    assert.ok(patch.statusCode === 200 || patch.statusCode === 204, patch.body);
    const reread = await app.inject({ method: 'GET', url: `/api/analysis/${an.id}`, headers: auth(token) });
    assert.equal(JSON.parse(reread.body).document[0].text, '1.  Edited by hand', 'edit persisted');

    // Surfaces on the Documents page.
    const docs = await app.inject({ method: 'GET', url: '/api/documents', headers: auth(token) });
    assert.ok(JSON.parse(docs.body).some((d: { name: string }) => d.name === an.fileName), 'draft shows in documents');

    // Rich formatting from the editor persists (marks, align, lists, links).
    const formatted = [
      { type: 'heading', text: 'Section', level: 1 },
      {
        type: 'paragraph',
        align: 'center',
        segments: ['see ', { text: 'bold', marks: ['b'] }, { text: 'x', href: 'https://ex.com' }],
      },
      { type: 'bullet', segments: [{ text: 'point', marks: ['i'] }] },
      { type: 'numbered', segments: ['step'] },
    ];
    const rich = await app.inject({ method: 'PATCH', url: `/api/analysis/${an.id}/document`, headers: auth(token), payload: { document: formatted } });
    assert.equal(rich.statusCode, 200, rich.body);
    const back = JSON.parse((await app.inject({ method: 'GET', url: `/api/analysis/${an.id}`, headers: auth(token) })).body);
    assert.equal(back.document[0].level, 1, 'heading level persisted');
    assert.equal(back.document[1].align, 'center', 'alignment persisted');
    assert.deepEqual(back.document[1].segments[1], { text: 'bold', marks: ['b'] }, 'bold run persisted');
    assert.deepEqual(back.document[1].segments[2], { text: 'x', href: 'https://ex.com' }, 'hyperlink run persisted');
    assert.equal(back.document[2].type, 'bullet', 'bullet block persisted');
    assert.equal(back.document[3].type, 'numbered', 'numbered block persisted');

    // Malformed formatting is rejected with 400 (never a 500), defending the JSON shape.
    const reject = async (document: unknown, why: string) => {
      const r = await app.inject({ method: 'PATCH', url: `/api/analysis/${an.id}/document`, headers: auth(token), payload: { document } });
      assert.equal(r.statusCode, 400, `${why} → expected 400, got ${r.statusCode}`);
    };
    await reject([{ type: 'paragraph', segments: [{ text: 'x', marks: ['zzz'] }] }], 'invalid mark');
    await reject([{ type: 'quote', segments: ['x'] }], 'unknown block type');
    await reject([{ type: 'paragraph', align: 'justify', segments: ['x'] }], 'invalid align');
    await reject([{ type: 'paragraph', segments: [{ text: 'x', href: 'javascript:alert(1)' }] }], 'unsafe link scheme');
    await reject([{ type: 'paragraph', segments: [{ redlineId: 42 }] }], 'non-string redlineId');
    await reject([{ type: 'paragraph', segments: [123] }], 'non-object segment (must be 400 not 500)');
    await reject([null], 'non-object block (must be 400 not 500)');
  });

  it('is gated to plans that include contract drafting (Free → 402, feature drafting)', async () => {
    const { token } = await makeUser(); // Free plan
    const res = await app.inject({ method: 'POST', url: '/api/analysis/draft', headers: auth(token), payload: { prompt: 'A short NDA' } });
    assert.equal(res.statusCode, 402, 'Free plan must be told to upgrade');
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'feature_locked');
    assert.equal(body.details?.feature, 'drafting', 'гейт называется drafting, а не templates');
  });
});

describe('SSO', () => {
  it('secret sealing round-trips and rejects tampering', async () => {
    const { sealSecret, openSecret } = await import('../src/lib/secrets.ts');
    const sealed = sealSecret('super-secret-client-value');
    assert.notEqual(sealed, 'super-secret-client-value', 'stored form is encrypted');
    assert.equal(openSecret(sealed), 'super-secret-client-value', 'round-trips');
    assert.equal(openSecret(sealed.slice(0, -2) + 'xy'), null, 'tampered ciphertext → null');
    assert.equal(openSecret('garbage'), null, 'malformed → null');
  });

  it('config is gated to Business and rejects public mail domains', async () => {
    const free = await makeUser();
    const gated = await app.inject({ method: 'GET', url: '/api/team/sso', headers: auth(free.token) });
    assert.equal(gated.statusCode, 402, 'Free cannot use SSO');

    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    // Public mailbox domain is refused (account-takeover guard #2).
    const pub = await app.inject({
      method: 'PUT',
      url: '/api/team/sso',
      headers: auth(owner.token),
      payload: { issuerUrl: 'https://accounts.google.com', clientId: 'x', clientSecret: 'y', emailDomain: 'gmail.com', defaultRole: 'viewer' },
    });
    assert.equal(pub.statusCode, 400, 'public domain rejected');

    // Empty config for a Business owner reads cleanly.
    const empty = await app.inject({ method: 'GET', url: '/api/team/sso', headers: auth(owner.token) });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(JSON.parse(empty.body).configured, false);
    assert.ok(JSON.parse(empty.body).redirectUri.includes('/auth/sso/callback'));
  });

  it('lookup returns false for a domain without SSO', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sso/lookup', payload: { email: 'someone@no-sso-here.test' } });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).available, false);
  });

  it('enforcement blocks password login for an enforced member but never the owner', async () => {
    const { assertSsoNotRequired } = await import('../src/routes/sso.routes.ts');
    // Owner on Business with an enforced, verified SSO config for acme-test.example.
    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    await db.query(
      `INSERT INTO team_sso_config (owner_user_id, issuer_url, client_id, client_secret_enc, email_domain,
        authorization_endpoint, token_endpoint, userinfo_endpoint, default_role, enabled, enforce_sso, domain_verify_token, domain_verified)
       VALUES ($1, 'https://idp.example', 'cid', 'v1:x:y:z', 'acme-test.example', 'https://idp/a', 'https://idp/t', 'https://idp/u', 'viewer', true, true, 'tok', true)`,
      [owner.id],
    );
    // An active member on that domain.
    const memberId = 'u_ssomember';
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction, email_verified)
       VALUES ($1, 'bob@acme-test.example', 'x', 'Bob', 'B', 'Acme', 'UK', true)`,
      [memberId],
    );
    await db.query(
      `INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status)
       VALUES ('tm_sso1', $1, $2, 'Bob', 'bob@acme-test.example', 'viewer', 'active')`,
      [owner.id, memberId],
    );

    // Member is blocked; owner (break-glass) and an outsider are not.
    await assert.rejects(assertSsoNotRequired(db, { id: memberId, email: 'bob@acme-test.example' }), /SSO/);
    await assertSsoNotRequired(db, { id: owner.id, email: `owner-exempt@acme-test.example` }); // owner exempt (by id)
    await assertSsoNotRequired(db, { id: 'u_outsider', email: 'x@other.example' }); // different domain, fine
  });
});

describe('audit log', () => {
  it('audit rows are immutable (UPDATE blocked) but DELETE stays allowed for cascade/retention', async () => {
    const { id } = await makeUser(); // registering already wrote an audit event
    // History can never be rewritten.
    await assert.rejects(db.query("UPDATE audit_events SET status = 'x' WHERE team_owner_id = $1", [id]), /append-only/);
    // DELETE is allowed — deleting the account must CASCADE the trail away, and
    // the retention sweep must be able to purge old rows.
    const del = await db.query('DELETE FROM audit_events WHERE team_owner_id = $1 RETURNING id', [id]);
    assert.ok(del.rows.length > 0, 'delete of own audit rows is permitted');
  });

  it('deleting an account cascades its audit trail away (no trigger veto)', async () => {
    const u = await makeUser();
    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: auth(u.token), payload: { confirm: u.email } });
    assert.equal(del.statusCode, 204, del.body);
    const remaining = await db.query('SELECT id FROM audit_events WHERE team_owner_id = $1', [u.id]);
    assert.equal(remaining.rows.length, 0, 'audit rows removed with the account');
  });

  it('viewer is gated to Business: Free → 402, Business owner → own events only', async () => {
    const free = await makeUser();
    const gated = await app.inject({ method: 'GET', url: '/api/audit/events', headers: auth(free.token) });
    assert.equal(gated.statusCode, 402, 'Free plan cannot read the audit log');

    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    // Generate an event under the owner's scope.
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(owner.token) });
    // (logout bumped token_version → need a fresh login to read)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: owner.email, password: 'Passw0rd!123' } });
    const token2 = JSON.parse(login.body).token;
    const list = await app.inject({ method: 'GET', url: '/api/audit/events', headers: auth(token2) });
    assert.equal(list.statusCode, 200, list.body);
    const events = JSON.parse(list.body);
    assert.ok(Array.isArray(events) && events.length > 0, 'owner sees their own events');
    assert.ok(events.every((e: { type: string }) => typeof e.type === 'string'), 'events carry a type');
    // Total count header is present.
    assert.ok(list.headers['x-total-count'], 'X-Total-Count present');

    // CSV export works and is gated the same way.
    const csv = await app.inject({ method: 'GET', url: '/api/audit/events.csv', headers: auth(token2) });
    assert.equal(csv.statusCode, 200);
    assert.ok(csv.headers['content-type']?.includes('text/csv'));
    assert.ok(csv.body.startsWith('time,actor,event'), 'CSV header');
  });

  it('failed logins are recorded and never store a password', async () => {
    const u = await makeUser();
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'wrong-password' } });
    const events = await db.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_events WHERE event_type = 'auth.login_failed' AND metadata->>'email' = $1",
      [u.email],
    );
    assert.ok(events.rows.length > 0, 'failed login recorded');
    const meta = JSON.stringify(events.rows[0].metadata);
    assert.ok(!meta.includes('wrong-password'), 'password never stored in the audit metadata');
  });

  it('free-text search (q) matches actor/type/target and escapes LIKE wildcards', async () => {
    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    // The registration + login above already wrote events labelled with the email.
    const hit = await app.inject({
      method: 'GET',
      url: `/api/audit/events?q=${encodeURIComponent(owner.email)}`,
      headers: auth(owner.token),
    });
    assert.equal(hit.statusCode, 200, hit.body);
    assert.ok((JSON.parse(hit.body) as unknown[]).length > 0, 'search by own email finds events');

    const byType = await app.inject({ method: 'GET', url: '/api/audit/events?q=auth.login', headers: auth(owner.token) });
    assert.ok((JSON.parse(byType.body) as unknown[]).length > 0, 'search by event type works');

    const miss = await app.inject({ method: 'GET', url: '/api/audit/events?q=zzz-no-such-thing', headers: auth(owner.token) });
    assert.equal((JSON.parse(miss.body) as unknown[]).length, 0, 'no false hits');

    // "%" must be treated literally, not as match-everything.
    const pct = await app.inject({ method: 'GET', url: `/api/audit/events?q=${encodeURIComponent('%')}`, headers: auth(owner.token) });
    assert.equal((JSON.parse(pct.body) as unknown[]).length, 0, 'wildcards are escaped');
  });

  it('q search never crosses tenants: owner A searching owner B finds nothing', async () => {
    const a = await makeUser();
    const b = await makeUser(); // b's registration/login events exist and mention b.email
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [a.id]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/audit/events?q=${encodeURIComponent(b.email)}`,
      headers: auth(a.token),
    });
    assert.equal(res.statusCode, 200);
    assert.equal((JSON.parse(res.body) as unknown[]).length, 0, "A must never see B's trail via search");
  });
});

describe('analytics summary (extended)', () => {
  it('returns monthly, risk centre, compliance and no team for a solo user', async () => {
    const u = await makeUser();
    // One real analysis (dev fallback) → a document + findings + review event.
    const created = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: 'risky.pdf', fileSize: '10 KB', jurisdiction: 'UZ' },
    });
    assert.equal(created.statusCode, 201, created.body);

    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const s = JSON.parse(res.body);

    assert.equal(s.monthly.length, 12, '12 calendar months');
    const totalReviews = s.monthly.reduce((n: number, m: { reviews: number }) => n + m.reviews, 0);
    assert.ok(totalReviews >= 1, 'the fresh review lands in the current month');
    assert.ok(s.monthly[11].reviews >= 1, 'last bucket is the current month');
    // Month keys are real calendar months, oldest → newest, ending at now (UTC).
    const now = new Date();
    const key = (off: number) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - off, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    assert.equal(s.monthly[11].month, key(0), 'last bucket labelled with the current month');
    assert.equal(s.monthly[0].month, key(11), 'first bucket labelled 11 months back');

    assert.ok(s.riskCenter.topContracts.length >= 1, 'top contracts include the analysed document');
    assert.equal(typeof s.riskCenter.topContracts[0].riskScore, 'number');
    assert.ok(s.riskCenter.topContracts[0].id, 'contracts carry a stable id (React keys)');
    assert.ok(s.riskCenter.byJurisdiction.some((j: { jurisdiction: string }) => j.jurisdiction === 'UZ'));

    // The dev-fallback analysis produces findings → the citation tally is not empty.
    assert.ok(s.compliance.verified + s.compliance.unverified >= 1, 'citation stats reflect real findings');
    assert.ok(Array.isArray(s.compliance.corpus));

    assert.equal(s.team, null, 'no team section for a solo user');
  });

  it('a review from a previous month lands in ITS month bucket, not the current one', async () => {
    const u = await makeUser();
    const prev = new Date();
    prev.setUTCMonth(prev.getUTCMonth() - 2, 15); // safely inside month -2
    await db.query('INSERT INTO review_events (id, user_id, risk_score, created_at) VALUES ($1, $2, 40, $3)', [
      `re_test_${Date.now()}`,
      u.id,
      prev.toISOString(),
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(u.token) });
    const s = JSON.parse(res.body);
    assert.equal(s.monthly[9].reviews, 1, 'bucket index 9 = two months back');
    assert.equal(s.monthly[11].reviews, 0, 'nothing counted in the current month');
  });

  it('topContracts uses the LATEST analysis per document, not the scariest ever', async () => {
    const u = await makeUser();
    // Two analyses of the same file → same document, two analysis rows.
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/analysis',
        headers: auth(u.token),
        payload: { fileName: 'same-doc.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
      });
      assert.equal(r.statusCode, 201, r.body);
    }
    // Force distinguishable scores: older=90, newest=10.
    await db.query(
      `UPDATE analyses SET risk_score = 90, created_at = now() - interval '2 hours'
        WHERE id = (SELECT id FROM analyses WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1)`,
      [u.id],
    );
    await db.query(
      `UPDATE analyses SET risk_score = 10
        WHERE id = (SELECT id FROM analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
      [u.id],
    );
    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(u.token) });
    const s = JSON.parse(res.body);
    const doc = s.riskCenter.topContracts.find((c: { name: string }) => c.name === 'same-doc.pdf');
    assert.ok(doc, 'the document is present');
    assert.equal(doc.riskScore, 10, 'the LATEST analysis wins (the 90 one is history)');
  });

  it("one user's data never leaks into another's analytics", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(a.token),
      payload: { fileName: 'private-a.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(b.token) });
    const s = JSON.parse(res.body);
    assert.ok(
      !s.riskCenter.topContracts.some((c: { name: string }) => c.name.includes('private-a')),
      "b must not see a's contracts",
    );
    assert.equal(s.riskCenter.byJurisdiction.length, 0, 'no jurisdiction rows from foreign documents');
    assert.equal(s.riskCenter.byCounterparty.length, 0, 'no counterparty rows from foreign documents');
    assert.equal(s.compliance.verified + s.compliance.unverified, 0, 'no citation stats from foreign findings');
    const monthlySum = s.monthly.reduce(
      (n: number, m: { reviews: number; findings: number }) => n + m.reviews + m.findings,
      0,
    );
    assert.equal(monthlySum, 0, "a's activity never shows in b's monthly chart");
  });

  it("team workload counts ONLY work inside the owner's team — a member's private reviews stay invisible", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    await db.query(
      `INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status)
       VALUES ($1, $2, $3, 'M Member', $4, 'editor', 'active')`,
      [`tm_test_${Date.now()}`, owner.id, member.id, member.email],
    );
    // The member works on their OWN documents (private practice)…
    const own = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(member.token),
      payload: { fileName: 'member-private.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    assert.equal(own.statusCode, 201, own.body);
    // …and the owner runs one analysis of their own.
    const owners = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(owner.token),
      payload: { fileName: 'owner-doc.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    assert.equal(owners.statusCode, 201, owners.body);

    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(owner.token) });
    const s = JSON.parse(res.body);
    assert.ok(Array.isArray(s.team), 'owner with an active member gets the team section');
    assert.equal(s.team.length, 2, 'owner + one member');
    const ownerRow = s.team.find((m: { role: string }) => m.role === 'owner');
    const memberRow = s.team.find((m: { role: string }) => m.role === 'editor');
    assert.ok(ownerRow.reviews30d >= 1, "owner's own in-team analysis is counted");
    assert.equal(memberRow.reviews30d, 0, "member's PRIVATE work must not appear (privacy)");
    assert.equal(memberRow.lastActive, null, 'no in-team activity → no timestamp exposed');
    assert.ok(memberRow.id && ownerRow.id, 'rows carry stable ids');

    // And the member (not an owner) sees no team section at all.
    const asMember = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(member.token) });
    assert.equal(JSON.parse(asMember.body).team, null, 'members do not get the owner dashboard');
  });
});

describe('billing lifecycle', () => {
  // Платёжного самообслуживания в продукте нет: тариф выдаёт только владелец
  // из админ-панели. Ниже — что клиентский путь НИЧЕГО не выдаёт, и что
  // выданный тариф корректно заканчивается по сроку.
  async function grant(userId: string, plan: string): Promise<void> {
    const { activatePlan } = await import('../src/lib/billing.ts');
    const email = (await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows[0].email;
    await activatePlan(db, userId, email, plan, 'monthly', { grantedBy: 'test@admin', note: 'test' });
  }

  it('клиентский checkout НЕ выдаёт тариф ни при каких входных данных', async () => {
    const { id, token } = await makeUser();
    for (const payload of [
      { plan: 'Standard', consent: true },
      { plan: 'Business', consent: true, period: 'yearly' },
      { plan: 'Free', consent: true },
      {},
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload });
      assert.equal(res.statusCode, 402, `${JSON.stringify(payload)} → ${res.body}`);
      assert.equal(JSON.parse(res.body).code, 'manual_billing');
    }
    const row = await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [id]);
    assert.equal(row.rows[0]?.plan ?? 'Free', 'Free', 'тариф остался бесплатным');
  });

  it('выдача пишется в append-only billing_events', async () => {
    const { id } = await makeUser();
    await grant(id, 'Pro');
    const events = await db.query<{ kind: string }>('SELECT kind FROM billing_events WHERE user_id = $1', [id]);
    const kinds = events.rows.map((r) => r.kind);
    assert.ok(kinds.includes('terms_accepted'), 'регистрация записала принятие условий');
    assert.ok(kinds.includes('granted'), 'выдача записана');
    await assert.rejects(db.query("UPDATE billing_events SET kind = 'x' WHERE user_id = $1", [id]), /append-only/);
    await assert.rejects(db.query('DELETE FROM billing_events WHERE user_id = $1', [id]), /append-only/);
  });

  it('cancel schedules end-of-period downgrade and can be reverted', async () => {
    const { id, token } = await makeUser();
    await grant(id, 'Business');
    const cancel = await app.inject({ method: 'POST', url: '/api/billing/cancel', headers: auth(token), payload: {} });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(JSON.parse(cancel.body).cancelAtPeriodEnd, true);
    const sub = await app.inject({ method: 'GET', url: '/api/billing/subscription', headers: auth(token) });
    assert.equal(JSON.parse(sub.body).cancelAtPeriodEnd, true, 'cancellation is visible');
    const revert = await app.inject({ method: 'POST', url: '/api/billing/cancel/revert', headers: auth(token), payload: {} });
    assert.equal(revert.statusCode, 200, revert.body);
    assert.equal(JSON.parse(revert.body).cancelAtPeriodEnd, false);
  });

  it('обход идемпотентен: истёкшая выдача → Free, второй прогон безопасен', async () => {
    const { checkBillingLifecycle } = await import('../src/lib/billing.ts');
    const { id } = await makeUser();
    await grant(id, 'Pro');
    await db.query("UPDATE subscriptions SET renews_at = now() - interval '1 day' WHERE user_id = $1", [id]);
    await checkBillingLifecycle(db);
    const after1 = await db.query<{ plan: string; status: string }>('SELECT plan, status FROM subscriptions WHERE user_id = $1', [id]);
    assert.equal(after1.rows[0].plan, 'Free', 'срок истёк — вернули на Free');
    assert.equal(after1.rows[0].status, 'active');
    const downgrades = await db.query<{ n: string | number }>(
      "SELECT count(*) AS n FROM billing_events WHERE user_id = $1 AND kind = 'downgraded'", [id]);
    await checkBillingLifecycle(db); // второй прогон не должен повторить понижение
    const after2 = await db.query<{ n: string | number }>(
      "SELECT count(*) AS n FROM billing_events WHERE user_id = $1 AND kind = 'downgraded'", [id]);
    assert.equal(Number(after2.rows[0].n), Number(downgrades.rows[0].n), 'понижение не повторилось');
  });
});

describe('finding → redline anchor', () => {
  it('analysis findings carry a redlineId linking to the clause', async () => {
    const { token } = await makeUser();
    const created = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(token),
      payload: { fileName: 'anchor.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const an = JSON.parse(created.body);
    // The dev fallback links each finding to a redline (r1/r2/r3).
    const linked = an.findings.filter((f: { redlineId?: string | null }) => f.redlineId);
    assert.ok(linked.length > 0, 'at least one finding has a redlineId');
    // Every linked redlineId must reference a real redline in the same analysis.
    const redlineIds = new Set(an.redlines.map((r: { id: string }) => r.id));
    for (const f of linked) assert.ok(redlineIds.has(f.redlineId), `redlineId ${f.redlineId} exists`);

    // Persisted: reload the analysis and confirm the link survives.
    const reread = await app.inject({ method: 'GET', url: `/api/analysis/${an.id}`, headers: auth(token) });
    const reloaded = JSON.parse(reread.body);
    assert.ok(reloaded.findings.some((f: { redlineId?: string | null }) => f.redlineId), 'redlineId persisted');
  });
});

describe('redline decisions (accept / reject / revert)', () => {
  it('a decision can be reverted back to pending (undo)', async () => {
    const { token } = await makeUser();
    const created = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(token),
      payload: { fileName: 'redline.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const an = JSON.parse(created.body);
    assert.ok(an.redlines.length > 0, 'fallback analysis has redlines');
    const rid = an.redlines[0].id;

    const accept = await app.inject({
      method: 'PATCH',
      url: `/api/analysis/${an.id}/redlines/${rid}`,
      headers: auth(token),
      payload: { status: 'accepted' },
    });
    assert.equal(accept.statusCode, 200, accept.body);
    assert.equal(JSON.parse(accept.body).status, 'accepted');

    // Undo: revert the accepted redline back to pending.
    const revert = await app.inject({
      method: 'PATCH',
      url: `/api/analysis/${an.id}/redlines/${rid}`,
      headers: auth(token),
      payload: { status: 'pending' },
    });
    assert.equal(revert.statusCode, 200, revert.body);
    assert.equal(JSON.parse(revert.body).status, 'pending', 'reverted to pending');

    // A bogus status is still rejected.
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/analysis/${an.id}/redlines/${rid}`,
      headers: auth(token),
      payload: { status: 'maybe' },
    });
    assert.equal(bad.statusCode, 400, 'invalid status rejected');
  });
});

describe('chat SSE streaming', () => {
  it('streams token + done events when Accept: text/event-stream', async () => {
    const { token } = await makeUser();
    const session = await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'stream test' } });
    assert.equal(session.statusCode, 201, session.body);
    const sessionId = JSON.parse(session.body).id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${sessionId}/messages`,
      headers: { ...auth(token), accept: 'text/event-stream' },
      payload: { text: 'What is a warranty?' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(res.headers['content-type']?.includes('text/event-stream'), 'SSE content-type');
    assert.ok(res.body.includes('event: token'), 'emits a token event');
    assert.ok(res.body.includes('event: done'), 'emits a done event with the persisted message');
    // The done payload carries a real persisted assistant message id.
    const doneLine = res.body.split('\n').find((l) => l.startsWith('data:') && l.includes('"role":"assistant"'));
    assert.ok(doneLine, 'done event carries the assistant message');
  });

  // «Работаю…» вместо трёх точек (2026-10-25): шаги идут по ходу работы и
  // описывают только то, что сервер реально сделал.
  it('streams real work steps before the answer: prompt → draft → search → mode → answer', async () => {
    const { token } = await makeUser();
    const sessionId = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'steps' } })).body,
    ).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${sessionId}/messages`,
      headers: { ...auth(token), accept: 'text/event-stream' },
      payload: { text: '/plan Взыскать долг по поставке', jurisdiction: 'Uzbek law', draftTitle: 'Договор поставки', draftText: 'Пункт 1. Срок оплаты 10 дней.' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const events = res.body
      .split('\n\n')
      .filter((r) => r.startsWith('event: step'))
      .map((r) => JSON.parse(r.split('\ndata: ')[1]) as { id: string; status: string; data?: Record<string, unknown> });
    const order = events.map((e) => `${e.id}:${e.status}`);
    assert.deepEqual(order.slice(0, 2), ['prompt:done', 'contract:done']);
    assert.equal(events[1].data?.name, 'Договор поставки');
    const searchDone = events.find((e) => e.id === 'search' && e.status === 'done');
    assert.ok(searchDone, `search step finished: ${order.join(', ')}`);
    assert.equal(searchDone?.data?.jurisdiction, 'UZ');
    assert.equal(typeof searchDone?.data?.found, 'number');
    assert.ok(order.indexOf('search:active') < order.indexOf('search:done'));
    assert.deepEqual(events.find((e) => e.id === 'mode')?.data, { mode: 'plan' });
    assert.equal(order[order.length - 1], 'answer:active', 'last step is «thinking about the answer»');
    // Шаги — до текста ответа.
    assert.ok(res.body.indexOf('event: step') < res.body.indexOf('event: token'));
  });

  it('a refused request (too many files) is a plain HTTP error, not a half-open stream', async () => {
    const { token } = await makeUser();
    const sessionId = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'refuse' } })).body,
    ).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${sessionId}/messages`,
      headers: { ...auth(token), accept: 'text/event-stream' },
      payload: { text: 'x', uploadIds: ['up_a', 'up_b', 'up_c'] },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.ok(!res.headers['content-type']?.includes('text/event-stream'));
  });

  // Вопрос к черновику шаблона: анализа нет, контекстом служит draftText —
  // фолбэк-ответ детерминированно различает «есть документ» и «нет документа».
  it('draftText grounds the reply in the saved draft', async () => {
    const { token } = await makeUser();
    const session = await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'draft qa' } });
    const sessionId = JSON.parse(session.body).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${sessionId}/messages`,
      headers: auth(token),
      payload: { text: 'Какой срок в пункте 2?', draftTitle: 'NDA', draftText: 'Пункт 2. Срок действия — 30 дней.' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(
      JSON.parse(res.body).text.includes('вижу документ'),
      'reply must take the has-document path (draft text reached docContext)',
    );
  });

  it('non-streaming POST still returns plain JSON', async () => {
    const { token } = await makeUser();
    const session = await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'plain' } });
    const sessionId = JSON.parse(session.body).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${sessionId}/messages`,
      headers: auth(token),
      payload: { text: 'Hello' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(res.headers['content-type']?.includes('application/json'), 'plain JSON when no Accept: text/event-stream');
    assert.equal(JSON.parse(res.body).role, 'assistant');
  });
});

// Вложения чата (2026-10-25): файлы уходят вместе с вопросом, а не запускают
// разбор рисков. Фолбэк-ответ (ИИ в тестах нет) детерминированно говорит
// «вижу документ», когда контекст файла дошёл до модели.
describe('chat attachments (files sent with the question)', () => {
  const upload = async (token: string, name: string, body: string | Buffer, type = 'text/plain') => {
    const boundary = '----lexabAttachBoundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body) as { id: string; fileName: string; fileSize: string };
  };
  const newChat = async (token: string): Promise<string> =>
    JSON.parse((await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'files' } })).body).id;
  const ask = (token: string, sessionId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/chats/${sessionId}/messages`, headers: auth(token), payload });
  const messages = async (token: string, sessionId: string) =>
    JSON.parse((await app.inject({ method: 'GET', url: `/api/chats/${sessionId}/messages`, headers: auth(token) })).body) as {
      role: string;
      text?: string;
      attachments?: { name: string; size: string }[];
    }[];

  it('grounds the reply in the files, shows them on the message, and keeps them for follow-ups', async () => {
    const { token } = await makeUser();
    const file = await upload(token, 'Договор поставки.txt', 'Пункт 5. Неустойка 0,1% в день от суммы долга.');
    const sessionId = await newChat(token);

    const first = await ask(token, sessionId, { text: 'Какая неустойка?', uploadIds: [file.id] });
    assert.equal(first.statusCode, 200, first.body);
    assert.ok(JSON.parse(first.body).text.includes('вижу документ'), 'file text must reach the model context');

    // Следующий вопрос без вложений — файл чата всё ещё в контексте.
    const next = await ask(token, sessionId, { text: 'А с какого дня она считается?' });
    assert.ok(JSON.parse(next.body).text.includes('вижу документ'), 'follow-up must still see the chat file');

    const list = await messages(token, sessionId);
    const asked = list.find((m) => m.text === 'Какая неустойка?');
    assert.deepEqual(asked?.attachments, [{ name: 'Договор поставки.txt', size: file.fileSize }]);
    assert.equal(list.find((m) => m.text === 'А с какого дня она считается?')?.attachments, undefined);
  });

  it('caps files per message by plan: Free 2, paid 5', async () => {
    const u = await makeUser();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await upload(u.token, `file-${i}.txt`, `Текст файла ${i}.`)).id);
    const sessionId = await newChat(u.token);

    const overFree = await ask(u.token, sessionId, { text: 'Сравни', uploadIds: ids.slice(0, 3) });
    assert.equal(overFree.statusCode, 400, overFree.body);
    assert.match(overFree.body, /не больше 2/);
    assert.equal((await messages(u.token, sessionId)).length, 0, 'a refused question is not stored');
    assert.equal((await ask(u.token, sessionId, { text: 'Сравни', uploadIds: ids.slice(0, 2) })).statusCode, 200);

    await db.query("UPDATE subscriptions SET plan = 'Pro' WHERE user_id = $1", [u.id]);
    assert.equal((await ask(u.token, sessionId, { text: 'Сравни пять', uploadIds: ids.slice(0, 5) })).statusCode, 200);
    const overPaid = await ask(u.token, sessionId, { text: 'Сравни шесть', uploadIds: ids });
    assert.equal(overPaid.statusCode, 400, overPaid.body);
    assert.match(overPaid.body, /не больше 5/);
  });

  it("refuses someone else's upload and malformed ids", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const foreign = await upload(owner.token, 'Чужой договор.txt', 'Секретные условия.');
    const sessionId = await newChat(stranger.token);
    const res = await ask(stranger.token, sessionId, { text: 'Что там?', uploadIds: [foreign.id] });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal((await messages(stranger.token, sessionId)).length, 0);
    assert.equal((await ask(stranger.token, sessionId, { text: 'x', uploadIds: 'up_1' })).statusCode, 400);
    assert.equal((await ask(stranger.token, sessionId, { text: 'x', uploadIds: [42] })).statusCode, 400);
  });

  it('accepts an Excel file for chat but refuses it for risk review', async () => {
    const { zipStore } = await import('./zip-helper.ts');
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const book = zipStore({
      'xl/workbook.xml': `<workbook ${NS}><sheets><sheet name="Сроки" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Поставка №7</t></is></c></row></sheetData></worksheet>`,
    });
    const { token } = await makeUser();
    const file = await upload(token, 'Сроки.xlsx', book, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const sessionId = await newChat(token);
    const res = await ask(token, sessionId, { text: 'Что в таблице?', uploadIds: [file.id] });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(JSON.parse(res.body).text.includes('вижу документ'));

    const review = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(token),
      payload: { fileName: 'Сроки.xlsx', fileSize: file.fileSize, uploadId: file.id },
    });
    assert.equal(review.statusCode, 400, review.body);
  });

  it('buildAttachmentsContext: names every file and splits the text budget between them', async () => {
    const { buildAttachmentsContext } = await import('../src/lib/chatAttachments.ts');
    const { id, token } = await makeUser();
    const a = await upload(token, 'Короткий.txt', 'Срок оплаты — 10 дней.');
    const b = await upload(token, 'Длинный.txt', 'Б'.repeat(5000));
    const ctx = await buildAttachmentsContext(
      db,
      id,
      [
        { uploadId: a.id, name: 'Короткий.txt', size: a.fileSize },
        { uploadId: b.id, name: 'Длинный.txt', size: b.fileSize },
      ],
      { budget: 2000 },
    );
    assert.ok(ctx?.startsWith('The user attached 2 files'), ctx);
    assert.ok(ctx?.includes('=== File 1: Короткий.txt') && ctx.includes('Срок оплаты — 10 дней.'));
    assert.ok(ctx?.includes('=== File 2: Длинный.txt'));
    assert.ok(ctx?.includes('[Text truncated: showing the first 1000 of 5000 characters'), 'each file gets half the budget');
    // Чужой пользователь не прочитает файл, даже зная id.
    const other = await makeUser();
    const foreign = await buildAttachmentsContext(db, other.id, [{ uploadId: a.id, name: 'Короткий.txt', size: a.fileSize }]);
    assert.ok(foreign?.includes('[The file was deleted') && !foreign.includes('Срок оплаты'));
  });
});

// Правая колонка чата (2026-10-25): отметки шагов плана хранятся в чате,
// статьи из базы законов — у ответа ИИ.
describe('chat progress & sources', () => {
  const newChatWithReply = async (token: string) => {
    const sessionId = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/chats', headers: auth(token), payload: { title: 'progress' } })).body,
    ).id as string;
    const reply = await app.inject({ method: 'POST', url: `/api/chats/${sessionId}/messages`, headers: auth(token), payload: { text: '/plan Взыскать долг' } });
    assert.equal(reply.statusCode, 200, reply.body);
    return { sessionId, messageId: JSON.parse(reply.body).id as string };
  };

  it('saves plan step ticks per chat and reads them back', async () => {
    const { token } = await makeUser();
    const { sessionId, messageId } = await newChatWithReply(token);
    const empty = await app.inject({ method: 'GET', url: `/api/chats/${sessionId}/progress`, headers: auth(token) });
    assert.deepEqual(JSON.parse(empty.body), {});

    const put = await app.inject({ method: 'PUT', url: `/api/chats/${sessionId}/progress`, headers: auth(token), payload: { messageId, done: [2, 0, 2] } });
    assert.equal(put.statusCode, 200, put.body);
    assert.deepEqual(JSON.parse(put.body), { messageId, done: [0, 2] }, 'deduped and sorted');
    const got = await app.inject({ method: 'GET', url: `/api/chats/${sessionId}/progress`, headers: auth(token) });
    assert.deepEqual(JSON.parse(got.body), { messageId, done: [0, 2] });
  });

  it('refuses foreign chats, foreign messages and junk step numbers', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { sessionId, messageId } = await newChatWithReply(owner.token);
    const foreign = await app.inject({ method: 'PUT', url: `/api/chats/${sessionId}/progress`, headers: auth(other.token), payload: { messageId, done: [0] } });
    assert.equal(foreign.statusCode, 404);
    const read = await app.inject({ method: 'GET', url: `/api/chats/${sessionId}/progress`, headers: auth(other.token) });
    assert.equal(read.statusCode, 404);
    const otherChat = await newChatWithReply(owner.token);
    const wrongMsg = await app.inject({ method: 'PUT', url: `/api/chats/${sessionId}/progress`, headers: auth(owner.token), payload: { messageId: otherChat.messageId, done: [0] } });
    assert.equal(wrongMsg.statusCode, 400, 'a message from another chat is not this chat’s plan');
    for (const done of [[-1], [1.5], ['1'], 'x']) {
      const bad = await app.inject({ method: 'PUT', url: `/api/chats/${sessionId}/progress`, headers: auth(owner.token), payload: { messageId, done } });
      assert.equal(bad.statusCode, 400, JSON.stringify(done));
    }
  });

  // Ссылки на статьи (2026-10-25): https-адрес статьи на официальном сайте;
  // у ответов, сохранённых без ссылок, адрес находится по подписи в корпусе.
  it('keeps safe article links and finds them for older replies', async () => {
    await db.query(
      `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, source_url, retrieved_at, sha256_checksum)
       VALUES ('uz_tk_link', 'UZ', 'uz_tk_link', 'code', 'Трудовой кодекс Тестовой Республики', 'https://lex.uz/ru/docs/6257291', now(), 'uz_tk_link')
       ON CONFLICT (id) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO legal_units (id, document_id, unit_type, number, breadcrumb, text, language, official_unit_uri, source_url, retrieved_at, sha256_checksum, valid_from)
       VALUES ('uz_tk_link_st-320', 'uz_tk_link', 'article', '320', 'UZ / Трудовой кодекс Тестовой Республики / Глава 19 / ст.320', 'текст', 'ru',
               'https://lex.uz/ru/docs/6257291#6265223', 'https://lex.uz/ru/docs/6257291', now(), 'uz_tk_link_st-320', '2023-04-30')
       ON CONFLICT (id) DO NOTHING`,
    );
    const { token } = await makeUser();
    const { sessionId, messageId } = await newChatWithReply(token);
    await db.query('UPDATE chat_messages SET refs = $2::jsonb WHERE id = $1', [
      messageId,
      JSON.stringify([
        { label: 'ст.320', doc: 'Трудовой кодекс Тестовой Республики' }, // старый ответ — без ссылки
        { label: 'ст.1', doc: 'Закон', url: 'javascript:alert(1)' }, // не https — ссылку не отдаём
        { label: 'ст.2', doc: 'Закон', url: 'http://www.legislation.gov.uk/id/ukpga/2015/15/section/12' },
        { label: 'ст.999', doc: 'Нет такого закона' },
      ]),
    ]);
    const list = JSON.parse((await app.inject({ method: 'GET', url: `/api/chats/${sessionId}/messages`, headers: auth(token) })).body) as {
      id: string;
      refs?: { label: string; url?: string }[];
    }[];
    const refs = list.find((m) => m.id === messageId)?.refs ?? [];
    assert.equal(refs[0].url, 'https://lex.uz/ru/docs/6257291#6265223', 'found by label + law name');
    assert.equal(refs[1].url, undefined, 'javascript: dropped');
    assert.equal(refs[2].url, 'https://www.legislation.gov.uk/id/ukpga/2015/15/section/12', 'http upgraded to https');
    assert.equal(refs[3].url, undefined, 'unknown law — no link');
  });

  it('returns the law references stored with a reply', async () => {
    const { token } = await makeUser();
    const { sessionId, messageId } = await newChatWithReply(token);
    await db.query('UPDATE chat_messages SET refs = $2::jsonb WHERE id = $1', [
      messageId,
      JSON.stringify([{ label: 'Статья 333', doc: 'Гражданский кодекс Республики Узбекистан' }, { junk: true }]),
    ]);
    const list = JSON.parse((await app.inject({ method: 'GET', url: `/api/chats/${sessionId}/messages`, headers: auth(token) })).body) as {
      id: string;
      refs?: unknown;
    }[];
    assert.deepEqual(list.find((m) => m.id === messageId)?.refs, [{ label: 'Статья 333', doc: 'Гражданский кодекс Республики Узбекистан' }]);
  });
});

describe('file downloads stay decrypted and provider-URL-free', () => {
  it('POST /uploads returns no provider url and stores url = NULL', async () => {
    const u = await makeUser();
    const boundary = '----lexabTestBoundary42';
    const payload = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="contract.txt"\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        'Договор поставки: тестовое содержимое.\r\n' +
        `--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = JSON.parse(res.body);
    assert.equal('url' in body, false, 'provider URL must not be returned (points at ciphertext)');
    const row = await db.query<{ url: string | null }>('SELECT url FROM uploads WHERE id = $1', [body.id]);
    assert.equal(row.rows[0].url, null, 'stored url must be NULL');
  });

  it('GET /signatures/:id/signed.pdf serves the decrypted signed PDF to the owner only', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { saveFile } = await import('../src/storage.ts');
    const original = Buffer.from('%PDF-1.4 signed-bytes-тест');
    const stored = await saveFile(original, 'deal (signed).pdf', 'application/pdf');
    await db.query(
      `INSERT INTO signature_requests (id, user_id, document_name, status, signed_file_key)
       VALUES ('sig_dl1', $1, 'deal.pdf', 'Completed', $2)`,
      [owner.id, stored.key],
    );
    await db.query(
      `INSERT INTO signature_requests (id, user_id, document_name, status)
       VALUES ('sig_dl2', $1, 'draft.pdf', 'Sent')`,
      [owner.id],
    );

    const ok = await app.inject({ method: 'GET', url: '/api/signatures/sig_dl1/signed.pdf', headers: auth(owner.token) });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.headers['content-type'], 'application/pdf');
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.ok(Buffer.from(ok.rawPayload).equals(original), 'bytes must round-trip through the encryption envelope');

    const foreign = await app.inject({ method: 'GET', url: '/api/signatures/sig_dl1/signed.pdf', headers: auth(other.token) });
    assert.equal(foreign.statusCode, 404, 'another user must not download it');
    const notDone = await app.inject({ method: 'GET', url: '/api/signatures/sig_dl2/signed.pdf', headers: auth(owner.token) });
    assert.equal(notDone.statusCode, 404, 'incomplete request has no signed PDF');
  });
});

describe('audit log records who/what/ip and serves metadata', () => {
  it('ai.analysis carries actor + ip; document.deleted is logged; actorId filter and metadata work', async () => {
    const u = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [u.id]);

    // Анализ (dev-fallback LLM) → событие ai.analysis с актором и IP.
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: 'audit-test.pdf', fileSize: '10 KB' },
    });
    assert.equal(an.statusCode, 201, an.body);
    const documentId = JSON.parse(an.body).documentId;

    // Удаление документа → document.deleted.
    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: auth(u.token) });
    assert.equal(del.statusCode, 204, del.body);

    const list = await app.inject({ method: 'GET', url: '/api/audit/events', headers: auth(u.token) });
    assert.equal(list.statusCode, 200, list.body);
    const events = JSON.parse(list.body) as {
      type: string; actor: string | null; actorId: string | null; ip: string | null; metadata?: Record<string, unknown>;
    }[];

    const analysisEv = events.find((e) => e.type === 'ai.analysis');
    assert.ok(analysisEv, 'ai.analysis must be logged');
    assert.equal(analysisEv!.actor, u.email, 'actor email must be recorded');
    assert.ok(analysisEv!.ip, 'ip must be recorded (req is passed through)');
    assert.equal(analysisEv!.metadata?.feature, 'analysis', 'metadata must be served to the client');

    const deletedEv = events.find((e) => e.type === 'document.deleted');
    assert.ok(deletedEv, 'document.deleted must be logged');

    const uploadedEv = events.find((e) => e.type === 'file.uploaded');
    assert.ok(uploadedEv === undefined || uploadedEv.actor === u.email, 'file.uploaded (if present) carries the actor');

    // Фильтр по актору: свой id → события есть; чужой id → пусто.
    const mine = await app.inject({ method: 'GET', url: `/api/audit/events?actorId=${u.id}`, headers: auth(u.token) });
    assert.ok((JSON.parse(mine.body) as unknown[]).length > 0, 'actorId filter must match own events');
    const nobody = await app.inject({ method: 'GET', url: '/api/audit/events?actorId=u_ghost', headers: auth(u.token) });
    assert.equal((JSON.parse(nobody.body) as unknown[]).length, 0, 'foreign actorId must match nothing');
  });
});

describe('exports serve the FULL document and real DOCX', () => {
  it('POST /export/docx returns a real Word file (ZIP magic, Cyrillic content)', async () => {
    const u = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/docx',
      headers: auth(u.token),
      payload: { title: 'Договор поставки', content: 'Раздел 1. Предмет.\nПоставщик обязуется поставить товар.' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const bytes = Buffer.from(res.rawPayload);
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK', 'DOCX must be a real ZIP (not the old HTML-as-.doc trick)');
  });

  it('POST /export/pdf returns a real PDF with Cyrillic text (документ из панели чата)', async () => {
    const u = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/pdf',
      headers: auth(u.token),
      payload: { title: 'Претензия', content: 'ПРЕТЕНЗИЯ\n\nоб уплате неустойки за просрочку поставки\nМежду [Покупатель] и [Поставщик] заключён договор.' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(String(res.headers['content-disposition']), /\.pdf/);
    assert.equal(Buffer.from(res.rawPayload).subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('POST /export/pdf requires auth and text', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/export/pdf', payload: { title: 't', content: 'x' } });
    assert.equal(anon.statusCode, 401);
    const u = await makeUser();
    const empty = await app.inject({ method: 'POST', url: '/api/export/pdf', headers: auth(u.token), payload: { title: 't', content: '' } });
    assert.equal(empty.statusCode, 400);
  });

  it('document export mode=clean returns the FULL original text with accepted redlines applied', async () => {
    const u = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Pro' WHERE user_id = $1", [u.id]);
    // Анализ (dev-fallback) создаёт документ; затем подложим полный текст файла.
    const an = await app.inject({
      method: 'POST', url: '/api/analysis', headers: auth(u.token),
      payload: { fileName: 'full-export.pdf', fileSize: '10 KB' },
    });
    assert.equal(an.statusCode, 201, an.body);
    const parsed = JSON.parse(an.body);
    const { encText } = await import('../src/lib/docCrypto.ts');
    const full = 'ДОГОВОР ПОСТАВКИ № 7\n\nРаздел 1. Предмет договора.\n\nРаздел 9. Заключительные положения. Полный текст присутствует.';
    await db.query(
      `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
       VALUES ('up_fullexp', $1, 'full-export.pdf', 100, 'application/pdf', 'local', 'k_fullexp', NULL, $2)`,
      [u.id, await encText(db, u.id, full)],
    );
    const res = await app.inject({
      method: 'POST', url: `/api/documents/${parsed.documentId}/export`, headers: auth(u.token),
      payload: { format: 'docx', mode: 'clean' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const bytes = Buffer.from(res.rawPayload);
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
    // DOCX = ZIP; текст лежит в word/document.xml (deflate). Проверяем через
    // распаковку зипа штатным zlib по локальным заголовкам.
    const { inflateRawSync } = await import('node:zlib');
    let xml = '';
    for (let off = 0; off < bytes.length - 4; ) {
      if (bytes.readUInt32LE(off) !== 0x04034b50) break;
      const nameLen = bytes.readUInt16LE(off + 26);
      const extraLen = bytes.readUInt16LE(off + 28);
      const compSize = bytes.readUInt32LE(off + 18);
      const name = bytes.subarray(off + 30, off + 30 + nameLen).toString();
      const data = bytes.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + compSize);
      if (name === 'word/document.xml') {
        xml = inflateRawSync(data).toString('utf8');
        break;
      }
      off += 30 + nameLen + extraLen + compSize;
    }
    assert.ok(xml.includes('Полный текст присутствует'), 'clean export must contain the FULL original text, not just review clauses');
  });
});

describe('playbooks', () => {
  it('are gated to Pro+, do CRUD, encrypt rules at rest, and enforce ownership', async () => {
    // Free plan: feature is gated → 402.
    const free = await makeUser();
    const gated = await app.inject({ method: 'GET', url: '/api/playbooks', headers: auth(free.token) });
    assert.equal(gated.statusCode, 402, 'playbooks must be gated below Pro');

    const pro = await makeProUser();
    const created = await app.inject({
      method: 'POST',
      url: '/api/playbooks',
      headers: auth(pro.token),
      payload: { name: 'Стандартные позиции', jurisdiction: 'UZ', rules: ['Неустойка не выше 0.1% в день', 'Арбитраж только в Ташкенте'] },
    });
    assert.equal(created.statusCode, 201, created.body);
    const pb = JSON.parse(created.body);
    assert.equal(pb.name, 'Стандартные позиции');
    assert.equal(pb.jurisdiction, 'UZ');
    assert.equal(pb.rules.length, 2);
    assert.equal(pb.active, true);

    // Rule text is encrypted at rest — the plaintext must not be in the column.
    const raw = await db.query<{ text_enc: string }>('SELECT text_enc FROM playbook_rules WHERE playbook_id = $1 LIMIT 1', [pb.id]);
    assert.ok(!raw.rows[0].text_enc.includes('Ташкент'), 'playbook rule must be encrypted at rest');

    const list = await app.inject({ method: 'GET', url: '/api/playbooks', headers: auth(pro.token) });
    assert.equal(JSON.parse(list.body).length, 1);

    // Unknown jurisdiction is rejected.
    const badJur = await app.inject({ method: 'POST', url: '/api/playbooks', headers: auth(pro.token), payload: { name: 'x', jurisdiction: 'ZZ', rules: [] } });
    assert.equal(badJur.statusCode, 400);

    // Patch replaces rules and toggles active.
    const patched = await app.inject({ method: 'PATCH', url: `/api/playbooks/${pb.id}`, headers: auth(pro.token), payload: { active: false, rules: ['Только одно правило'] } });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(JSON.parse(patched.body).active, false);
    assert.equal(JSON.parse(patched.body).rules.length, 1);

    // A different team cannot delete this playbook.
    const other = await makeProUser();
    const foreign = await app.inject({ method: 'DELETE', url: `/api/playbooks/${pb.id}`, headers: auth(other.token) });
    assert.equal(foreign.statusCode, 404, 'must not delete another team\'s playbook');

    const del = await app.inject({ method: 'DELETE', url: `/api/playbooks/${pb.id}`, headers: auth(pro.token) });
    assert.equal(del.statusCode, 204);
  });

  it('an active global playbook is loaded into an analysis without breaking it', async () => {
    const pro = await makeProUser();
    // Global playbook (no jurisdiction) → applies to any contract.
    const pbRes = await app.inject({ method: 'POST', url: '/api/playbooks', headers: auth(pro.token), payload: { name: 'Global', rules: ['Ответственность ограничена суммой договора'] } });
    assert.equal(pbRes.statusCode, 201, pbRes.body);
    // Analysis (dev fallback) still succeeds with the playbook loaded + threaded in.
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(pro.token), payload: { fileName: 'supply.pdf', fileSize: '12 KB', jurisdiction: 'UZ' } });
    assert.equal(an.statusCode, 201, an.body);
    const body = JSON.parse(an.body);
    // Every finding carries the playbookDeviation flag (false under the dev fallback).
    for (const f of body.findings) assert.equal(typeof f.playbookDeviation, 'boolean');
  });
});

describe('clm (contract lifecycle)', () => {
  it('analysis persists terms + obligations, dashboard is gated Pro+, done survives re-analysis', async () => {
    // Free plan: dashboard is gated → 402.
    const free = await makeUser();
    const gated = await app.inject({ method: 'GET', url: '/api/contracts', headers: auth(free.token) });
    assert.equal(gated.statusCode, 402, 'contracts dashboard must be gated below Pro');

    const pro = await makeProUser();
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(pro.token),
      payload: { fileName: 'msa.pdf', fileSize: '15 KB', jurisdiction: 'GB' },
    });
    assert.equal(an.statusCode, 201, an.body);
    const documentId = JSON.parse(an.body).documentId as string;

    // Dashboard shows the contract with extracted terms + obligations.
    const list = await app.inject({ method: 'GET', url: '/api/contracts', headers: auth(pro.token) });
    assert.equal(list.statusCode, 200, list.body);
    const rows = JSON.parse(list.body);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.documentId, documentId);
    assert.ok(row.terms.expiryDate, 'expiry date extracted');
    assert.equal(typeof row.terms.daysToExpiry, 'number');
    assert.equal(row.obligations.length, 2, 'fallback yields 2 obligations');

    // Obligation text is encrypted at rest.
    const raw = await db.query<{ text_enc: string }>(
      'SELECT text_enc FROM contract_obligations WHERE document_id = $1 LIMIT 1',
      [documentId],
    );
    assert.ok(!raw.rows[0].text_enc.includes('Company'), 'obligation text must be encrypted at rest');

    // Single-document card (for the document page).
    const one = await app.inject({ method: 'GET', url: `/api/contracts/${documentId}`, headers: auth(pro.token) });
    assert.equal(one.statusCode, 200, one.body);
    assert.equal(JSON.parse(one.body).obligations.length, 2);

    // Another user must not see this document's terms.
    const foreign = await app.inject({ method: 'GET', url: `/api/contracts/${documentId}`, headers: auth((await makeProUser()).token) });
    assert.equal(foreign.statusCode, 404);

    // Mark an obligation done…
    const obId = row.obligations[0].id as string;
    const done = await app.inject({
      method: 'PATCH',
      url: `/api/contracts/${documentId}/obligations/${obId}`,
      headers: auth(pro.token),
      payload: { done: true },
    });
    assert.equal(done.statusCode, 200, done.body);

    // …and it survives a re-analysis of the same file (same obligation text).
    const again = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(pro.token),
      payload: { fileName: 'msa.pdf', fileSize: '15 KB', jurisdiction: 'GB' },
    });
    assert.equal(again.statusCode, 201, again.body);
    const after = JSON.parse((await app.inject({ method: 'GET', url: `/api/contracts/${documentId}`, headers: auth(pro.token) })).body);
    const kept = after.obligations.find((o: { text: string }) => o.text === row.obligations[0].text);
    assert.ok(kept, 're-analysis keeps the obligation');
    assert.equal(kept.done, true, 'done mark must survive re-analysis');
  });

  it('checkContractDeadlines reminds once about expiry and due obligations (idempotent)', async () => {
    const { checkContractDeadlines } = await import('../src/routes/contracts.routes.ts');
    const pro = await makeProUser();
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(pro.token),
      payload: { fileName: 'lease.pdf', fileSize: '9 KB', jurisdiction: 'GB' },
    });
    assert.equal(an.statusCode, 201, an.body);
    const documentId = JSON.parse(an.body).documentId as string;

    // Force near deadlines: contract expires in 10 days, one obligation in 3.
    await db.query(
      `UPDATE contract_terms SET expiry_date = CURRENT_DATE + 10, expiry_reminded = false,
              auto_renew = false, renewal_reminded = false WHERE document_id = $1`,
      [documentId],
    );
    await db.query(
      `UPDATE contract_obligations SET due_date = CURRENT_DATE + 3, reminded = false, done = false
       WHERE document_id = $1`,
      [documentId],
    );

    await checkContractDeadlines(db);
    const count = async (title: string): Promise<number> =>
      Number(
        (
          await db.query<{ count: string | number }>(
            'SELECT count(*) AS count FROM notifications WHERE user_id = $1 AND title = $2',
            [pro.id, title],
          )
        ).rows[0].count,
      );
    assert.equal(await count('Срок договора истекает'), 1, 'one expiry reminder');
    assert.ok((await count('Срок обязательства близко')) >= 1, 'obligation reminder sent');
    const obligationReminders = await count('Срок обязательства близко');

    // Second run: reminded-flags dedupe — no new notifications.
    await checkContractDeadlines(db);
    assert.equal(await count('Срок договора истекает'), 1, 'no duplicate expiry reminder');
    assert.equal(await count('Срок обязательства близко'), obligationReminders, 'no duplicate obligation reminder');
  });

  it('a stale (past) expiry that is corrected to a near-future date still fires a reminder', async () => {
    const { checkContractDeadlines } = await import('../src/routes/contracts.routes.ts');
    const pro = await makeProUser();
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(pro.token), payload: { fileName: 'stale.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    // Extracted date landed in the PAST → sweep marks reminded=true WITHOUT sending.
    await db.query('UPDATE contract_terms SET expiry_date = CURRENT_DATE - 2, expiry_reminded = false, auto_renew = false WHERE document_id = $1', [documentId]);
    await checkContractDeadlines(db);
    const noNotif = await db.query<{ count: string | number }>("SELECT count(*) AS count FROM notifications WHERE user_id = $1 AND title = 'Срок договора истекает'", [pro.id]);
    assert.equal(Number(noNotif.rows[0].count), 0, 'a past date sends nothing');
    const flag = await db.query<{ expiry_reminded: boolean }>('SELECT expiry_reminded FROM contract_terms WHERE document_id = $1', [documentId]);
    assert.equal(flag.rows[0].expiry_reminded, true, 'the stale row is marked to stop daily churn');

    // Re-analysis corrects the date to a near-future one — the upsert must RESET
    // the flag (the past date was never really reminded), so the reminder fires.
    await db.query(
      `INSERT INTO contract_terms (document_id, expiry_date, expiry_reminded) VALUES ($1, CURRENT_DATE + 5, true)
       ON CONFLICT (document_id) DO UPDATE SET
         expiry_reminded = CASE
           WHEN contract_terms.expiry_date IS NOT DISTINCT FROM EXCLUDED.expiry_date THEN contract_terms.expiry_reminded
           WHEN contract_terms.expiry_date IS NULL OR EXCLUDED.expiry_date IS NULL THEN false
           WHEN contract_terms.expiry_date < CURRENT_DATE THEN false
           WHEN ABS(EXCLUDED.expiry_date - contract_terms.expiry_date) > 3 THEN false
           ELSE contract_terms.expiry_reminded END,
         expiry_date = EXCLUDED.expiry_date`,
      [documentId],
    );
    const reset = await db.query<{ expiry_reminded: boolean }>('SELECT expiry_reminded FROM contract_terms WHERE document_id = $1', [documentId]);
    assert.equal(reset.rows[0].expiry_reminded, false, 'correcting a past date to the future re-arms the reminder');
    await checkContractDeadlines(db);
    const fired = await db.query<{ count: string | number }>("SELECT count(*) AS count FROM notifications WHERE user_id = $1 AND title = 'Срок договора истекает'", [pro.id]);
    assert.equal(Number(fired.rows[0].count), 1, 'the corrected near-future deadline now reminds');
  });
});

describe('batch review', () => {
  // Upload a .txt file via the real /uploads route and return its id.
  async function uploadFile(token: string, name: string, content: string): Promise<string> {
    const boundary = '----lexabBatchBoundary';
    const payload = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        'Content-Type: text/plain\r\n\r\n' +
        `${content}\r\n` +
        `--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body).id;
  }

  it('is gated Pro+, processes each uploaded file, and best-effort skips a bad id', async () => {
    const { runBatch } = await import('../src/routes/batch.routes.ts');

    // Free plan: gated → 402.
    const free = await makeUser();
    const gated = await app.inject({ method: 'POST', url: '/api/batch', headers: auth(free.token), payload: { uploadIds: ['x'] } });
    assert.equal(gated.statusCode, 402, 'batch must be gated below Pro');

    const pro = await makeProUser();
    const u1 = await uploadFile(pro.token, 'a.txt', 'Договор поставки № 1. Срок действия до 2027 года.');
    const u2 = await uploadFile(pro.token, 'b.txt', 'Договор аренды № 2. Ответственность сторон.');

    // Start a batch of 2 valid + 1 bogus id (best-effort: bogus is dropped at intake).
    const start = await app.inject({
      method: 'POST',
      url: '/api/batch',
      headers: auth(pro.token),
      payload: { uploadIds: [u1, u2, 'up_does_not_exist'], jurisdiction: 'GB' },
    });
    assert.equal(start.statusCode, 201, start.body);
    const job = JSON.parse(start.body);
    assert.equal(job.total, 2, 'only the caller\'s real uploads are queued');
    assert.equal(job.status, 'queued');

    // Drive processing deterministically (autostart disabled in tests).
    await runBatch(db, job.id);

    const res = await app.inject({ method: 'GET', url: `/api/batch/${job.id}`, headers: auth(pro.token) });
    assert.equal(res.statusCode, 200, res.body);
    const done = JSON.parse(res.body);
    assert.equal(done.status, 'done');
    assert.equal(done.done, 2, 'both files analysed');
    assert.equal(done.failed, 0);
    assert.equal(done.items.length, 2);
    for (const it of done.items) {
      assert.equal(it.status, 'done', `item ${it.fileName} done`);
      assert.ok(it.documentId && it.analysisId, 'analysis persisted → linked document');
      assert.equal(typeof it.riskScore, 'number');
    }

    // Each analysis is a normal document — visible in the Documents list.
    const docs = await app.inject({ method: 'GET', url: '/api/documents', headers: auth(pro.token) });
    const names = JSON.parse(docs.body).map((d: { name: string }) => d.name);
    assert.ok(names.includes('a.txt') && names.includes('b.txt'), 'batch documents appear in the repository');
  });

  it('boot recovery finishes interrupted batches and honestly fails interrupted workflows', async () => {
    const { resumeBatchJobs, runBatch } = await import('../src/routes/batch.routes.ts');
    const { failInterruptedWorkflows } = await import('../src/routes/workflows.routes.ts');
    const pro = await makeProUser();
    const u1 = await uploadFile(pro.token, 'r1.txt', 'Договор поставки — прерван.');
    const u2 = await uploadFile(pro.token, 'r2.txt', 'Договор аренды — в очереди.');
    const start = await app.inject({ method: 'POST', url: '/api/batch', headers: auth(pro.token), payload: { uploadIds: [u1, u2] } });
    const jobId = JSON.parse(start.body).id as string;
    // Симуляция падения: первый элемент застрял в processing, задание — тоже.
    // Heartbeat состарен: у мёртвого инстанса updated_at перестаёт бампаться,
    // и только такие (5+ мин тишины) задания recovery вправе трогать.
    await db.query("UPDATE batch_items SET status = 'processing' WHERE batch_id = $1 AND ord = 0", [jobId]);
    await db.query("UPDATE batch_jobs SET status = 'processing', updated_at = now() - interval '10 minutes' WHERE id = $1", [jobId]);

    // awaitRuns: в проде свип запускает прогоны и сразу отдаёт такт (иначе он
    // держал бы очередь фоновых задач часами), тесту нужен детерминированный итог.
    await resumeBatchJobs(db, { awaitRuns: true });
    const after = JSON.parse((await app.inject({ method: 'GET', url: `/api/batch/${jobId}`, headers: auth(pro.token) })).body);
    assert.equal(after.status, 'done', 'job must be finalized, not stuck in processing');
    const interrupted = after.items.find((i: { fileName: string }) => i.fileName === 'r1.txt');
    const finished = after.items.find((i: { fileName: string }) => i.fileName === 'r2.txt');
    assert.equal(interrupted.status, 'error', 'the mid-flight item is honestly marked interrupted');
    assert.match(interrupted.error, /перезапуск/i);
    assert.equal(finished.status, 'done', 'queued items are completed on resume');

    // Прерванный воркфлоу → честный failed с понятной ошибкой.
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(pro.token), payload: { fileName: 'wfstuck.pdf', fileSize: '8 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    const wf = await app.inject({ method: 'POST', url: '/api/workflows/run', headers: auth(pro.token), payload: { documentId, steps: [{ kind: 'analyze' }] } });
    const runId = JSON.parse(wf.body).id as string; // остаётся queued (autostart off в тестах)
    // Состарить heartbeat: recovery трогает только осиротевшие (5+ мин) запуски.
    await db.query("UPDATE workflow_runs SET updated_at = now() - interval '10 minutes' WHERE id = $1", [runId]);
    await failInterruptedWorkflows(db);
    const run = JSON.parse((await app.inject({ method: 'GET', url: `/api/workflows/${runId}`, headers: auth(pro.token) })).body);
    assert.equal(run.status, 'failed');
    assert.match(run.error, /перезапуск/i);
    void runBatch; // (импортирован для симметрии — прямые вызовы выше через resume)
  });

  it('rejects an empty upload list and enforces job ownership', async () => {
    const pro = await makeProUser();
    const empty = await app.inject({ method: 'POST', url: '/api/batch', headers: auth(pro.token), payload: { uploadIds: [] } });
    assert.equal(empty.statusCode, 400);

    const u = await uploadFile(pro.token, 'own.txt', 'Договор.');
    const start = await app.inject({ method: 'POST', url: '/api/batch', headers: auth(pro.token), payload: { uploadIds: [u] } });
    const jobId = JSON.parse(start.body).id;

    // A different Pro user must not read this job.
    const other = await makeProUser();
    const foreign = await app.inject({ method: 'GET', url: `/api/batch/${jobId}`, headers: auth(other.token) });
    assert.equal(foreign.statusCode, 404, 'must not read another user\'s batch job');
  });
});

describe('agentic workflows', () => {
  it('gated Pro+, runs analyze → apply high-severity redlines → start approval', async () => {
    const { runWorkflow } = await import('../src/routes/workflows.routes.ts');

    // Free plan: gated → 402.
    const free = await makeUser();
    const gated = await app.inject({ method: 'POST', url: '/api/workflows/run', headers: auth(free.token), payload: { documentId: 'x', steps: [{ kind: 'analyze' }] } });
    assert.equal(gated.statusCode, 402, 'workflows must be gated below Pro');

    const pro = await makeProUser();
    // Seed a document with an analysis (dev fallback → r1 High, r2/r3 Medium).
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(pro.token), payload: { fileName: 'deal.pdf', fileSize: '12 KB', jurisdiction: 'GB' } });
    assert.equal(an.statusCode, 201, an.body);
    const documentId = JSON.parse(an.body).documentId as string;

    const start = await app.inject({
      method: 'POST',
      url: '/api/workflows/run',
      headers: auth(pro.token),
      payload: {
        documentId,
        steps: [
          { kind: 'analyze' },
          { kind: 'apply-redlines', minSeverity: 'High' },
          { kind: 'send-for-approval', approvers: [{ name: 'Партнёр', email: 'partner@firm.com', role: 'Партнёр' }] },
        ],
      },
    });
    assert.equal(start.statusCode, 201, start.body);
    const run = JSON.parse(start.body);
    assert.equal(run.status, 'queued');
    assert.equal(run.steps.length, 3);

    // Drive execution deterministically (autostart disabled in tests).
    await runWorkflow(db, run.id);

    const res = await app.inject({ method: 'GET', url: `/api/workflows/${run.id}`, headers: auth(pro.token) });
    assert.equal(res.statusCode, 200, res.body);
    const done = JSON.parse(res.body);
    assert.equal(done.status, 'done', done.error ?? '');
    assert.ok(done.analysisId, 'analyze step produced a fresh analysis');

    // The High redline (r1) was accepted; a Medium one (r2) stays pending.
    const analysis = JSON.parse((await app.inject({ method: 'GET', url: `/api/analysis/${done.analysisId}`, headers: auth(pro.token) })).body);
    const r1 = analysis.redlines.find((r: { id: string }) => r.id === 'r1');
    const r2 = analysis.redlines.find((r: { id: string }) => r.id === 'r2');
    assert.equal(r1.status, 'accepted', 'High-severity redline accepted');
    assert.equal(r2.status, 'pending', 'Medium redline left for manual review');

    // An active approval flow now exists for the document.
    const flows = JSON.parse((await app.inject({ method: 'GET', url: `/api/approvals?documentId=${documentId}`, headers: auth(pro.token) })).body);
    assert.ok(flows.some((f: { status: string }) => f.status === 'active'), 'approval chain started');
  });

  it('fails cleanly on a non-owner and enforces run ownership', async () => {
    const pro = await makeProUser();
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(pro.token), payload: { fileName: 'w2.pdf', fileSize: '8 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    const start = await app.inject({ method: 'POST', url: '/api/workflows/run', headers: auth(pro.token), payload: { documentId, steps: [{ kind: 'analyze' }] } });
    const runId = JSON.parse(start.body).id;

    // Another Pro user cannot start a workflow on this document (not owner → 403/404).
    const other = await makeProUser();
    const foreignRun = await app.inject({ method: 'POST', url: '/api/workflows/run', headers: auth(other.token), payload: { documentId, steps: [{ kind: 'analyze' }] } });
    assert.ok(foreignRun.statusCode === 403 || foreignRun.statusCode === 404, 'non-owner cannot run a workflow');

    // …nor read this run.
    const foreignGet = await app.inject({ method: 'GET', url: `/api/workflows/${runId}`, headers: auth(other.token) });
    assert.equal(foreignGet.statusCode, 404, 'must not read another user\'s workflow run');
  });
});

describe('2FA (TOTP)', () => {
  it('enrol → enable → login now needs a code → backup code works → disable', async () => {
    const { totpCode } = await import('../src/lib/totp.ts');
    const email = `tfa_${Date.now()}@test.local`;
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: 'Passw0rd!123' } });
    assert.equal(reg.statusCode, 201);
    const vrow = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
    await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: vrow.rows[0].verify_token } });
    const token = JSON.parse((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } })).body).token as string;

    // Setup требует пароль (step-up): без него — 401, иначе перехваченная
    // сессия позволяла бы привязать чужой второй фактор и запереть владельца.
    const noPass = await app.inject({ method: 'POST', url: '/api/me/2fa/setup', headers: auth(token) });
    assert.equal(noPass.statusCode, 401, noPass.body);
    const setup = await app.inject({ method: 'POST', url: '/api/me/2fa/setup', headers: auth(token), payload: { password: 'Passw0rd!123' } });
    assert.equal(setup.statusCode, 200, setup.body);
    const { secret, otpauthUri } = JSON.parse(setup.body);
    assert.ok(secret && otpauthUri.includes('otpauth://totp/'));

    // A wrong code is rejected; the right one enables + returns backup codes.
    const bad = await app.inject({ method: 'POST', url: '/api/me/2fa/enable', headers: auth(token), payload: { code: '000000' } });
    assert.equal(bad.statusCode, 400);
    const good = await app.inject({ method: 'POST', url: '/api/me/2fa/enable', headers: auth(token), payload: { code: totpCode(secret) } });
    assert.equal(good.statusCode, 200, good.body);
    const backupCodes = JSON.parse(good.body).backupCodes as string[];
    assert.equal(backupCodes.length, 10);

    // Login now demands the second factor — and the bare-password challenge is
    // NOT a failed attempt (no brute-force noise from every normal 2FA login).
    const noCode = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
    assert.equal(noCode.statusCode, 401);
    assert.equal(JSON.parse(noCode.body).code, 'totp_required');
    const failedEvents = await db.query<{ count: string | number }>(
      "SELECT count(*) AS count FROM audit_events WHERE event_type = 'auth.login_failed' AND actor_label = $1",
      [email],
    );
    assert.equal(Number(failedEvents.rows[0].count), 0, 'a code challenge must not log auth.login_failed');

    // Correct TOTP logs in. The enable step consumed the CURRENT step
    // (anti-replay), so sign in with the NEXT step's code (±30s drift is accepted).
    const loginCode = totpCode(secret, Date.now() + 30_000);
    const withCode = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123', code: loginCode } });
    assert.equal(withCode.statusCode, 200, withCode.body);

    // Anti-replay: the SAME code is rejected on a second login — and a REPLAYED
    // (valid) code is NOT logged as auth.login_failed (it's not an attack).
    const failedBefore = Number((await db.query<{ count: string | number }>("SELECT count(*) AS count FROM audit_events WHERE event_type = 'auth.login_failed' AND actor_label = $1", [email])).rows[0].count);
    const replay = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123', code: loginCode } });
    assert.equal(replay.statusCode, 401, 'a TOTP code must be single-use (RFC 6238 anti-replay)');
    const failedAfter = Number((await db.query<{ count: string | number }>("SELECT count(*) AS count FROM audit_events WHERE event_type = 'auth.login_failed' AND actor_label = $1", [email])).rows[0].count);
    assert.equal(failedAfter, failedBefore, 'a replayed VALID code must not feed the brute-force detector');

    // A backup code also logs in — and is single-use.
    const withBackup = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123', backupCode: backupCodes[0] } });
    assert.equal(withBackup.statusCode, 200, 'backup code logs in');
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123', backupCode: backupCodes[0] } });
    assert.equal(reuse.statusCode, 401, 'a backup code cannot be reused');

    // Disable requires the password; then password-only login works again.
    const freshToken = JSON.parse(withCode.body).token as string;
    const disNoPw = await app.inject({ method: 'POST', url: '/api/me/2fa/disable', headers: auth(freshToken), payload: { password: 'wrong' } });
    assert.equal(disNoPw.statusCode, 401);
    const dis = await app.inject({ method: 'POST', url: '/api/me/2fa/disable', headers: auth(freshToken), payload: { password: 'Passw0rd!123' } });
    assert.equal(dis.statusCode, 200, dis.body);
    const plain = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
    assert.equal(plain.statusCode, 200, '2FA off → password-only login works');
  });
});

describe('sessions, DSAR export, retention, access review', () => {
  it('records sessions and revoke-others rotates the token', async () => {
    const u = await makeUser();
    const sessions = JSON.parse((await app.inject({ method: 'GET', url: '/api/me/sessions', headers: auth(u.token) })).body);
    assert.ok(Array.isArray(sessions) && sessions.length >= 1, 'the login was recorded as a session');
    const revoke = await app.inject({ method: 'POST', url: '/api/me/sessions/revoke-others', headers: auth(u.token) });
    assert.equal(revoke.statusCode, 200, revoke.body);
    const newToken = JSON.parse(revoke.body).token as string;
    // The old token is now invalid (token_version bumped); the new one works.
    const oldStillWorks = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: auth(u.token) });
    assert.equal(oldStillWorks.statusCode, 401, 'old token revoked');
    const newWorks = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: auth(newToken) });
    assert.equal(newWorks.statusCode, 200, 'fresh token works');
  });

  it('DSAR export: readable HTML by default, machine JSON via ?format=json', async () => {
    const u = await makeUser();
    await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'export-me.pdf', fileSize: '10 KB', jurisdiction: 'GB' } });

    const html = await app.inject({ method: 'GET', url: '/api/me/export', headers: auth(u.token) });
    assert.equal(html.statusCode, 200, html.body);
    assert.match(html.headers['content-type'] as string, /text\/html/);
    assert.match(html.headers['content-disposition'] as string, /attachment; filename="lexab-data-export\.html"/);
    assert.ok(html.body.includes('<!doctype html>'), 'full html document');
    assert.ok(html.body.includes(u.email), 'account email present');
    assert.ok(html.body.includes('export-me.pdf'), 'document name present');
    assert.ok(!html.body.includes('<script'), 'no scripts in the export');

    const res = await app.inject({ method: 'GET', url: '/api/me/export?format=json', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.headers['content-disposition'] as string, /attachment; filename="lexab-data-export\.json"/);
    const data = JSON.parse(res.body);
    assert.equal(data.account.email, u.email);
    assert.ok(Array.isArray(data.documents) && data.documents.length >= 1, 'documents included');
    assert.ok(Array.isArray(data.analyses) && data.analyses.length >= 1, 'analyses included');
    assert.ok(typeof data.analyses[0].summary === 'string', 'analysis summary decrypted in export');
  });

  it('DSAR HTML export escapes user-controlled values (no XSS in the file)', async () => {
    const u = await makeUser();
    await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: '<img src=x onerror=alert(1)>.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/me/export', headers: auth(u.token) });
    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.includes('<img src=x'), 'raw html from user data must not survive');
    assert.ok(res.body.includes('&lt;img src=x'), 'user value present but escaped');
  });

  it('soft-deletes a document and the retention sweep crypto-shreds it', async () => {
    const { checkRetention } = await import('../src/routes/documents.routes.ts');
    const u = await makeUser();
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'trash.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;

    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: auth(u.token) });
    assert.equal(del.statusCode, 204);
    // Hidden from the app immediately…
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/documents', headers: auth(u.token) })).body);
    assert.ok(!list.some((d: { id: string }) => d.id === documentId), 'soft-deleted doc hidden from list');
    const detail = await app.inject({ method: 'GET', url: `/api/documents/${documentId}`, headers: auth(u.token) });
    assert.equal(detail.statusCode, 404, 'soft-deleted doc 404s');
    // …but still physically present (recoverable within the window).
    const still = await db.query('SELECT 1 FROM documents WHERE id = $1', [documentId]);
    assert.equal(still.rows.length, 1, 'row kept for the retention window');

    // Age it past the window and run the purge → row gone (crypto-shred).
    await db.query("UPDATE documents SET deleted_at = now() - interval '400 days' WHERE id = $1", [documentId]);
    await checkRetention(db);
    const gone = await db.query('SELECT 1 FROM documents WHERE id = $1', [documentId]);
    assert.equal(gone.rows.length, 0, 'purged after retention window');
  });

  it('password reset cannot bypass 2FA: reset/confirm demands a code and accepts it', async () => {
    const { totpCode } = await import('../src/lib/totp.ts');
    const email = `tfareset_${Date.now()}@test.local`;
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'R', email, password: 'Passw0rd!123' } });
    const vrow = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
    await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: vrow.rows[0].verify_token } });
    const token = JSON.parse((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } })).body).token as string;
    const { secret } = JSON.parse((await app.inject({ method: 'POST', url: '/api/me/2fa/setup', headers: auth(token), payload: { password: 'Passw0rd!123' } })).body);
    await app.inject({ method: 'POST', url: '/api/me/2fa/enable', headers: auth(token), payload: { code: totpCode(secret) } });

    // Выпускаем reset-токен напрямую (в тестах письмо не приходит).
    await db.query(`UPDATE users SET reset_token = 'rst_2fa_test_token_123456', reset_expires = now() + interval '1 hour' WHERE id = $1`, [vrow.rows[0].id]);

    // Без кода: 401 totp_required, reset-токен НЕ израсходован, пароль НЕ сменён
    // (хеш сверяем по базе — вход съел бы код из окна дрейфа анти-replay'я).
    const hashBefore = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [vrow.rows[0].id])).rows[0].password_hash;
    const noCode = await app.inject({ method: 'POST', url: '/api/auth/reset/confirm', payload: { token: 'rst_2fa_test_token_123456', password: 'NewPassw0rd!456' } });
    assert.equal(noCode.statusCode, 401, noCode.body);
    assert.equal(JSON.parse(noCode.body).code, 'totp_required');
    const hashAfter = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [vrow.rows[0].id])).rows[0].password_hash;
    assert.equal(hashAfter, hashBefore, 'password unchanged after the challenge');

    // С кодом следующего шага (шаг включения израсходован анти-replay'ем): успех.
    const withCode = await app.inject({
      method: 'POST',
      url: '/api/auth/reset/confirm',
      payload: { token: 'rst_2fa_test_token_123456', password: 'NewPassw0rd!456', code: totpCode(secret, Date.now() + 30_000) },
    });
    assert.equal(withCode.statusCode, 200, withCode.body);
    assert.ok(JSON.parse(withCode.body).token, 'reset with a valid 2FA code issues a session');
  });

  it('soft-deleting a document cancels its active approval flow and kills the approve link', async () => {
    const pro = await makeProUser();
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(pro.token), payload: { fileName: 'appr-del.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    const flow = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: auth(pro.token),
      payload: { documentId, steps: [{ name: 'Партнёр', email: 'appr@firm.com' }] },
    });
    assert.equal(flow.statusCode, 201, flow.body);
    const stepToken = JSON.parse(flow.body).steps[0].token as string;
    assert.equal((await app.inject({ method: 'GET', url: `/api/approve/${stepToken}` })).statusCode, 200, 'link live before delete');

    await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: auth(pro.token) });
    const flows = await db.query<{ status: string }>('SELECT status FROM approval_flows WHERE document_id = $1', [documentId]);
    assert.equal(flows.rows[0].status, 'cancelled', 'active flow cancelled on soft-delete');
    const dead = await app.inject({ method: 'GET', url: `/api/approve/${stepToken}` });
    assert.ok(dead.statusCode >= 400, 'approve link must stop exposing a deleted document');
  });

  it('retention purge spares uploads created AFTER the document was trashed', async () => {
    const { checkRetention } = await import('../src/routes/documents.routes.ts');
    const u = await makeUser();
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'fresh-after.txt', fileSize: '1 KB', jurisdiction: 'GB' } });
    const docId = JSON.parse(an.body).documentId as string;
    await app.inject({ method: 'DELETE', url: `/api/documents/${docId}`, headers: auth(u.token) });
    await db.query("UPDATE documents SET deleted_at = now() - interval '400 days' WHERE id = $1", [docId]);
    // Свежая загрузка того же имени ПОСЛЕ удаления — анализ ещё не запущен.
    const boundary = '----lexabFreshBoundary';
    const payload = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="fresh-after.txt"\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        'Свежий файл, ждёт анализа.\r\n' +
        `--${boundary}--\r\n`,
    );
    const up = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const uploadId = JSON.parse(up.body).id as string;

    await checkRetention(db);
    assert.equal((await db.query('SELECT 1 FROM documents WHERE id = $1', [docId])).rows.length, 0, 'trashed doc purged');
    assert.equal((await db.query('SELECT 1 FROM uploads WHERE id = $1', [uploadId])).rows.length, 1, 'the fresh upload must survive the purge');
  });

  it('retention crypto-shreds the purged doc own bytes but keeps a live same-name doc bytes', async () => {
    const { checkRetention } = await import('../src/routes/documents.routes.ts');
    const u = await makeUser();
    const boundary = '----lexabShredBoundary';
    const up = async (content: string) =>
      app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="shred.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`,
        ),
      });
    const upA = JSON.parse((await up('Старая версия А.')).body).id as string;
    const anA = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'shred.txt', fileSize: '1 KB', jurisdiction: 'GB' } });
    const docA = JSON.parse(anA.body).documentId as string;
    await app.inject({ method: 'DELETE', url: `/api/documents/${docA}`, headers: auth(u.token) });
    const upB = JSON.parse((await up('Живая версия Б.')).body).id as string;
    await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'shred.txt', fileSize: '1 KB', jurisdiction: 'GB' } });

    // Реалистично: старая загрузка старше момента удаления, свежая (upB) — нет.
    await db.query("UPDATE documents SET deleted_at = now() - interval '400 days' WHERE id = $1", [docA]);
    await db.query("UPDATE uploads SET created_at = now() - interval '401 days' WHERE id = $1", [upA]);
    await checkRetention(db);
    assert.equal((await db.query('SELECT 1 FROM uploads WHERE id = $1', [upA])).rows.length, 0, "purged doc's own upload must be crypto-shredded (no leak)");
    assert.equal((await db.query('SELECT 1 FROM uploads WHERE id = $1', [upB])).rows.length, 1, "live same-name doc's upload must survive");
  });

  it('PATCH /documents cannot re-share a soft-deleted document', async () => {
    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(owner.token), payload: { fileName: 'reshare.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: auth(owner.token) });
    const reshare = await app.inject({ method: 'PATCH', url: `/api/documents/${documentId}`, headers: auth(owner.token), payload: { teamShared: true } });
    assert.equal(reshare.statusCode, 404, 'a soft-deleted document must not be re-shareable');
    const row = await db.query<{ team_shared: boolean }>('SELECT team_shared FROM documents WHERE id = $1', [documentId]);
    assert.equal(row.rows[0].team_shared, false, 'team_shared stays false on the deleted row');
  });

  it('content search skips soft-deleted documents', async () => {
    const u = await makeUser();
    const boundary = '----lexabSearchBoundary';
    await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="findme.txt"\r\nContent-Type: text/plain\r\n\r\nуникальноеслововдоговоре z;\r\n--${boundary}--\r\n`),
    });
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'findme.txt', fileSize: '1 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: auth(u.token) });
    const search = await app.inject({ method: 'GET', url: '/api/documents?search=findme', headers: auth(u.token) });
    const names = JSON.parse(search.body).map((d: { id: string }) => d.id);
    assert.ok(!names.includes(documentId), 'soft-deleted document must not appear in search');
  });

  it('analytics legacy findings join does not count another user findings on a timestamp+score collision', async () => {
    // User A: a legacy review_event (analysis_id NULL) that collides with B's analysis on (created_at, risk_score).
    const a = await makeUser();
    const b = await makeUser();
    const anB = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(b.token), payload: { fileName: 'bee.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const bAnalysis = await db.query<{ id: string; created_at: Date | string; risk_score: number }>(
      'SELECT id, created_at, risk_score FROM analyses WHERE id = $1',
      [JSON.parse(anB.body).id],
    );
    const bRow = bAnalysis.rows[0];
    // A legacy event for user A with the SAME created_at + risk_score as B's analysis.
    await db.query('INSERT INTO review_events (id, user_id, risk_score, created_at, analysis_id) VALUES ($1, $2, $3, $4, NULL)', [
      `re_collide_${Date.now()}`,
      a.id,
      bRow.risk_score,
      bRow.created_at,
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(a.token) });
    assert.equal(res.statusCode, 200, res.body);
    const monthly = JSON.parse(res.body).monthly as { findings: number }[];
    const totalFindings = monthly.reduce((s, m) => s + (m.findings ?? 0), 0);
    assert.equal(totalFindings, 0, "user A must not inherit user B's findings via the legacy collision join");
  });

  it('retention purge never destroys uploads of a LIVE document sharing the name', async () => {
    const { checkRetention } = await import('../src/routes/documents.routes.ts');
    const u = await makeUser();
    const boundary = '----lexabRetBoundary';
    const mkPayload = (content: string) =>
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="same-name.txt"\r\n' +
          'Content-Type: text/plain\r\n\r\n' +
          `${content}\r\n` +
          `--${boundary}--\r\n`,
      );
    const up = async (content: string) =>
      app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: mkPayload(content),
      });
    // Doc A: upload + analyze, then soft-delete it into the retention trash.
    assert.equal((await up('Договор аренды, версия А.')).statusCode, 201);
    const anA = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'same-name.txt', fileSize: '1 KB', jurisdiction: 'GB' } });
    const docA = JSON.parse(anA.body).documentId as string;
    await app.inject({ method: 'DELETE', url: `/api/documents/${docA}`, headers: auth(u.token) });
    // Doc B: re-upload the SAME name → a fresh live document.
    assert.equal((await up('Договор аренды, версия Б — живой.')).statusCode, 201);
    const anB = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'same-name.txt', fileSize: '1 KB', jurisdiction: 'GB' } });
    const docB = JSON.parse(anB.body).documentId as string;
    assert.notEqual(docB, docA, 're-upload creates a fresh document, not a revived one');

    // Age doc A past the window and purge.
    await db.query("UPDATE documents SET deleted_at = now() - interval '400 days' WHERE id = $1", [docA]);
    await checkRetention(db);
    assert.equal((await db.query('SELECT 1 FROM documents WHERE id = $1', [docA])).rows.length, 0, 'trashed doc purged');
    assert.equal((await db.query('SELECT 1 FROM documents WHERE id = $1', [docB])).rows.length, 1, 'live doc untouched');
    const uploadsLeft = await db.query('SELECT 1 FROM uploads WHERE user_id = $1 AND file_name = $2', [u.id, 'same-name.txt']);
    assert.ok(uploadsLeft.rows.length >= 1, "live document's uploads must survive the purge");
  });

  it('analytics excludes soft-deleted documents from risk centre and aggregates', async () => {
    const u = await makeUser();
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'secret-deal.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: auth(u.token) });
    const res = await app.inject({ method: 'GET', url: '/api/analytics/summary', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.stringify(JSON.parse(res.body).riskCenter ?? JSON.parse(res.body));
    assert.ok(!body.includes('secret-deal.pdf'), 'soft-deleted document must not surface in analytics');
  });

  it('a Free owner is not silently marked reminded — the reminder arrives after upgrading', async () => {
    const { checkContractDeadlines } = await import('../src/routes/contracts.routes.ts');
    const free = await makeUser(); // Free plan — no 'clm'
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(free.token), payload: { fileName: 'upgrade-later.pdf', fileSize: '9 KB', jurisdiction: 'GB' } });
    const documentId = JSON.parse(an.body).documentId as string;
    await db.query('UPDATE contract_terms SET expiry_date = CURRENT_DATE + 10, expiry_reminded = false, auto_renew = false WHERE document_id = $1', [documentId]);

    await checkContractDeadlines(db);
    const flag = await db.query<{ expiry_reminded: boolean }>('SELECT expiry_reminded FROM contract_terms WHERE document_id = $1', [documentId]);
    assert.equal(flag.rows[0].expiry_reminded, false, 'Free plan: flag must NOT be burned without sending');

    await db.query("UPDATE subscriptions SET plan = 'Pro' WHERE user_id = $1", [free.id]);
    await checkContractDeadlines(db);
    const count = await db.query<{ count: string | number }>(
      "SELECT count(*) AS count FROM notifications WHERE user_id = $1 AND title = 'Срок договора истекает'",
      [free.id],
    );
    assert.equal(Number(count.rows[0].count), 1, 'after upgrading, the reminder is delivered');
  });

  it('access review lists the team with roles and exports CSV', async () => {
    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    const member = await makeUser();
    await db.query(
      "INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status) VALUES ($1, $2, $3, $4, $5, 'editor', 'active')",
      [`tm_${Date.now()}`, owner.id, member.id, 'Team Member', member.email],
    );
    const review = await app.inject({ method: 'GET', url: '/api/team/access-review', headers: auth(owner.token) });
    assert.equal(review.statusCode, 200, review.body);
    const rows = JSON.parse(review.body);
    assert.ok(rows.some((r: { role: string }) => r.role === 'owner'), 'owner listed');
    assert.ok(rows.some((r: { email: string; role: string }) => r.email === member.email && r.role === 'editor'), 'member listed with role');

    const csv = await app.inject({ method: 'GET', url: '/api/team/access-review.csv', headers: auth(owner.token) });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.headers['content-type'] as string, /text\/csv/);
    assert.match(csv.body, /name,email,role,status,last_active/);
  });
});

// ── Launch-critical funnel coverage (pre-launch gap sweep) ────────────────────

describe('e-sign: полный цикл внешнего подписанта (встроенный режим)', () => {
  it('create → public view → sign by both → Completed → signed PDF downloads', async () => {
    const pro = await makeProUser();
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(pro.token),
      payload: { fileName: 'sign-loop.pdf', fileSize: '8 KB', jurisdiction: 'GB' },
    });
    assert.ok(an.statusCode < 300, an.body);

    const create = await app.inject({
      method: 'POST',
      url: '/api/signatures',
      headers: auth(pro.token),
      payload: {
        documentName: 'sign-loop.pdf',
        recipients: [
          { name: 'Анна К.', email: 'anna@ext.example' },
          { name: 'Bob T.', email: 'bob@ext.example' },
        ],
      },
    });
    assert.equal(create.statusCode, 201, create.body);
    const request = JSON.parse(create.body);
    const tokens = request.recipients.map((r: { token: string }) => r.token);
    assert.equal(tokens.length, 2);

    // Внешний подписант открывает ссылку БЕЗ авторизации и видит замороженный текст.
    const view = await app.inject({ method: 'GET', url: `/api/sign/${tokens[0]}` });
    assert.equal(view.statusCode, 200, view.body);
    const page = JSON.parse(view.body);
    assert.equal(page.signed, false);
    assert.ok(page.documentText && page.documentText.length > 0, 'signer sees the frozen document text');
    assert.equal(page.recipient.email, 'anna@ext.example');

    // Мусорный токен — честный 404, не 500 и не чужой документ.
    const bad = await app.inject({ method: 'GET', url: '/api/sign/definitely-not-a-token' });
    assert.equal(bad.statusCode, 404);

    const sign1 = await app.inject({ method: 'POST', url: `/api/sign/${tokens[0]}`, payload: { name: 'Анна Каренина' } });
    assert.ok(sign1.statusCode < 300, sign1.body);
    // Повторная подпись той же ссылкой — отклоняется.
    const dup = await app.inject({ method: 'POST', url: `/api/sign/${tokens[0]}`, payload: { name: 'Анна Каренина' } });
    assert.equal(dup.statusCode, 400);

    const sign2 = await app.inject({ method: 'POST', url: `/api/sign/${tokens[1]}`, payload: { name: 'Bob Turner' } });
    assert.ok(sign2.statusCode < 300, sign2.body);

    const list = await app.inject({ method: 'GET', url: '/api/signatures', headers: auth(pro.token) });
    const mine = JSON.parse(list.body).find((r: { id: string }) => r.id === request.id);
    assert.equal(mine.status, 'Completed', 'both signed → request completed');

    const pdf = await app.inject({ method: 'GET', url: `/api/signatures/${request.id}/signed.pdf`, headers: auth(pro.token) });
    assert.equal(pdf.statusCode, 200, 'built-in mode must produce a signed PDF');
    assert.ok(pdf.rawPayload.subarray(0, 5).toString('latin1').startsWith('%PDF'), 'a real PDF file');
  });
});

describe('main funnel: настоящий PDF → анализ → отчёты', () => {
  async function uploadBinary(token: string, name: string, buffer: Buffer, mime: string): Promise<string> {
    const boundary = '----lexabPdfBoundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
          `Content-Type: ${mime}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body).id;
  }

  it('a real PDF file round-trips through extractText into an analysis', async () => {
    const { buildSimplePdf } = await import('../src/lib/pdf.ts');
    const pro = await makeProUser();
    // Настоящий PDF (наш же генератор) — раньше pdf-parse не запускался ни одним тестом.
    const pdfBytes = await buildSimplePdf('Договор поставки', [
      { heading: '1. Предмет договора' },
      { text: 'Поставщик обязуется поставить оборудование до 31 декабря, неустойка 0,5% в день.' },
    ]);
    assert.ok(pdfBytes.subarray(0, 5).toString('latin1').startsWith('%PDF'));
    await uploadBinary(pro.token, 'real-contract.pdf', pdfBytes, 'application/pdf');

    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(pro.token),
      payload: { fileName: 'real-contract.pdf', fileSize: `${pdfBytes.length} B`, jurisdiction: 'UZ' },
    });
    assert.ok(an.statusCode < 300, an.body);
    const analysis = JSON.parse(an.body);
    assert.ok(analysis.id, 'analysis created from a parsed PDF');
    assert.ok(Array.isArray(analysis.document) && analysis.document.length > 0, 'document blocks present');
  });

  it('analysis report.pdf and document PDF export return real PDFs', async () => {
    const pro = await makeProUser();
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(pro.token),
      payload: { fileName: 'report-src.docx', fileSize: '9 KB', jurisdiction: 'UZ' },
    });
    assert.ok(an.statusCode < 300, an.body);
    const { id: analysisId, documentId } = JSON.parse(an.body);

    // Клиентский PDF-отчёт (там чинились кириллица/арабский — теперь под тестом).
    const report = await app.inject({ method: 'GET', url: `/api/analysis/${analysisId}/report.pdf`, headers: auth(pro.token) });
    assert.equal(report.statusCode, 200, report.body);
    assert.match(report.headers['content-type'] as string, /application\/pdf/);
    assert.ok(report.rawPayload.subarray(0, 5).toString('latin1').startsWith('%PDF'));
    assert.ok(report.rawPayload.length > 1000, 'report is not an empty shell');

    // Экспорт документа в PDF.
    const exp = await app.inject({
      method: 'POST',
      url: `/api/documents/${documentId}/export`,
      headers: auth(pro.token),
      payload: { format: 'pdf' },
    });
    assert.equal(exp.statusCode, 200, exp.body);
    assert.ok(exp.rawPayload.subarray(0, 5).toString('latin1').startsWith('%PDF'));
  });
});

describe('team: приглашение → принятие → смена роли → удаление', () => {
  it('runs the full membership lifecycle with ownership enforced', async () => {
    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]);
    const invitee = await makeUser();
    const stranger = await makeUser();

    // Пригласить самого себя нельзя; мусорная роль отклоняется.
    const self = await app.inject({ method: 'POST', url: '/api/team/invite', headers: auth(owner.token), payload: { email: owner.email, role: 'editor' } });
    assert.equal(self.statusCode, 400);
    const badRole = await app.inject({ method: 'POST', url: '/api/team/invite', headers: auth(owner.token), payload: { email: invitee.email, role: 'root' } });
    assert.equal(badRole.statusCode, 400);

    const invite = await app.inject({ method: 'POST', url: '/api/team/invite', headers: auth(owner.token), payload: { email: invitee.email, role: 'editor', title: 'Юрист' } });
    assert.equal(invite.statusCode, 201, invite.body);
    const member = JSON.parse(invite.body);
    assert.ok(member.inviteToken, 'owner view carries the join token');

    // Дубликат приглашения — 409.
    const dupInv = await app.inject({ method: 'POST', url: '/api/team/invite', headers: auth(owner.token), payload: { email: invitee.email, role: 'viewer' } });
    assert.equal(dupInv.statusCode, 409);

    // Чужой пользователь не может принять приглашение по этому токену.
    const strangerAccept = await app.inject({ method: 'POST', url: '/api/team/invitations/accept-by-token', headers: auth(stranger.token), payload: { token: member.inviteToken } });
    assert.ok(strangerAccept.statusCode >= 400, 'invite is bound to the invited email');

    const accept = await app.inject({ method: 'POST', url: '/api/team/invitations/accept-by-token', headers: auth(invitee.token), payload: { token: member.inviteToken } });
    assert.equal(accept.statusCode, 204, accept.body);

    const members = JSON.parse((await app.inject({ method: 'GET', url: '/api/team/members', headers: auth(owner.token) })).body);
    const joined = members.find((m: { email: string }) => m.email === invitee.email);
    assert.ok(joined, 'accepted member listed');
    assert.equal(joined.statusKey, 'team.status.active');
    assert.equal(joined.roleKey, 'team.role.editor');

    // Смена роли владельцем; посторонний — нет.
    const demote = await app.inject({ method: 'PATCH', url: `/api/team/members/${joined.id}`, headers: auth(owner.token), payload: { role: 'viewer' } });
    assert.equal(demote.statusCode, 200, demote.body);
    assert.equal(JSON.parse(demote.body).roleKey, 'team.role.viewer');
    const foreignPatch = await app.inject({ method: 'PATCH', url: `/api/team/members/${joined.id}`, headers: auth(stranger.token), payload: { role: 'editor' } });
    assert.ok(foreignPatch.statusCode >= 400, 'cross-tenant role change must fail');

    // Удаление участника.
    const remove = await app.inject({ method: 'DELETE', url: `/api/team/members/${joined.id}`, headers: auth(owner.token) });
    assert.ok(remove.statusCode < 300, remove.body);
    const after = JSON.parse((await app.inject({ method: 'GET', url: '/api/team/members', headers: auth(owner.token) })).body);
    assert.ok(!after.some((m: { email: string }) => m.email === invitee.email), 'removed member gone');
  });
});

describe('compare: две версии договора', () => {
  it('accepts fileA/fileB multipart and returns a structured diff', async () => {
    const pro = await makeProUser();
    const boundary = '----lexabCmpBoundary';
    const mk = (field: string, name: string, content: string) =>
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${name}"\r\n` +
      'Content-Type: text/plain\r\n\r\n' +
      `${content}\r\n`;
    const payload = Buffer.from(
      mk('fileA', 'v1.txt', 'Срок уведомления о расторжении — 3 месяца. Ответственность не ограничена.') +
        mk('fileB', 'v2.txt', 'Срок уведомления о расторжении — 1 месяц. Ответственность ограничена суммой договора.') +
        `--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/compare',
      headers: { ...auth(pro.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 200, res.body);
    const out = JSON.parse(res.body);
    assert.equal(out.fileA, 'v1.txt');
    assert.equal(out.fileB, 'v2.txt');
    assert.ok(Array.isArray(out.changes ?? out.diffs ?? out.items) || typeof out.summary === 'string', 'structured compare result');
  });
});

describe('tts (озвучка ответов)', () => {
  const realFetch = globalThis.fetch;
  // Каждый вызов Cloud TTS пишется сюда; failModels — какие model_name мок
  // отклоняет 404-м (для проверки фолбэка preview → stable); failCodes — какие
  // languageCode отклоняет 400-м (для негативного кэша); audioQueue — очередь
  // подменных аудио-байтов (для проверки склейки стрима), пусто = дефолт.
  let synthCalls: { voice: Record<string, unknown>; input: Record<string, unknown>; audioConfig: Record<string, unknown> }[] = [];
  let failModels: string[] = [];
  let failCodes: string[] = [];
  let audioQueue: Buffer[] = [];

  // Корректный ID3v2-заголовок (synchsafe-размер) + полезные MP3-байты.
  const withId3 = (tagBytes: number, payload: Buffer, footer = false): Buffer => {
    const h = Buffer.alloc(10);
    h.write('ID3', 0, 'latin1');
    h[3] = 4;
    h[5] = footer ? 0x10 : 0;
    h[6] = (tagBytes >> 21) & 0x7f;
    h[7] = (tagBytes >> 14) & 0x7f;
    h[8] = (tagBytes >> 7) & 0x7f;
    h[9] = tagBytes & 0x7f;
    return Buffer.concat([h, Buffer.alloc(tagBytes + (footer ? 10 : 0), 1), payload]);
  };

  before(() => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('texttospeech.googleapis.com')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as (typeof synthCalls)[number];
        synthCalls.push(body);
        if (failModels.includes(String(body.voice?.model_name))) {
          return new Response(JSON.stringify({ error: { message: 'model is not available' } }), { status: 404 });
        }
        if (failCodes.includes(String(body.voice?.languageCode))) {
          return new Response(JSON.stringify({ error: { message: 'INVALID_ARGUMENT: unsupported language code' } }), { status: 400 });
        }
        const audio = audioQueue.length ? audioQueue.shift()! : Buffer.from('ID3-fake-mp3-bytes');
        return new Response(JSON.stringify({ audioContent: audio.toString('base64') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = realFetch;
  });

  it('без токена — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tts', payload: { text: 'Привет' } });
    assert.equal(res.statusCode, 401);
  });

  it('пустой текст — 400', async () => {
    const u = await makeUser();
    const res = await app.inject({ method: 'POST', url: '/api/tts', headers: auth(u.token), payload: { text: '   ' } });
    assert.equal(res.statusCode, 400);
  });

  it('отдаёт MP3: модель 3.1 первой, русский languageCode, голос один', async () => {
    const u = await makeUser();
    synthCalls = [];
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: auth(u.token),
      payload: { text: 'Настоящий договор аренды может быть расторгнут в одностороннем порядке.' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.ok(res.rawPayload.toString('latin1').startsWith('ID3-fake'), 'бинарный MP3-ответ');
    assert.equal(synthCalls.length, 1);
    assert.equal(synthCalls[0].voice.model_name, 'gemini-3.1-flash-tts-preview');
    assert.equal(synthCalls[0].voice.languageCode, 'ru-RU');
    assert.equal(synthCalls[0].voice.name, 'Charon');
    assert.equal(typeof synthCalls[0].input.prompt, 'string', 'стилевая инструкция уходит в input.prompt');
    assert.equal(synthCalls[0].audioConfig.audioEncoding, 'MP3');
  });

  it('фолбэк: preview-модель недоступна → синтез на gemini-2.5-flash-tts', async () => {
    const u = await makeUser();
    synthCalls = [];
    failModels = ['gemini-3.1-flash-tts-preview'];
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tts',
        headers: auth(u.token),
        payload: { text: 'Договор поставки товара действует один год.' },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(synthCalls[0].voice.model_name, 'gemini-3.1-flash-tts-preview');
      assert.equal(synthCalls[synthCalls.length - 1].voice.model_name, 'gemini-2.5-flash-tts');
    } finally {
      failModels = [];
    }
  });

  it('длинный текст обрезается до лимита байт по границе предложения', async () => {
    const u = await makeUser();
    synthCalls = [];
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: auth(u.token),
      payload: { text: 'Стороны согласовали существенные условия сделки. '.repeat(300) },
    });
    assert.equal(res.statusCode, 200, res.body);
    const sent = String(synthCalls[0].input.text);
    assert.ok(Buffer.byteLength(sent, 'utf8') <= 3800, `обрезано до лимита (ушло ${Buffer.byteLength(sent, 'utf8')} байт)`);
    assert.ok(sent.trimEnd().endsWith('.'), 'обрезка по границе предложения');
  });

  it('определяет язык текста для languageCode на всех 6 языках', async () => {
    const { detectTtsLanguage } = await import('../src/routes/tts.routes.ts');
    assert.equal(detectTtsLanguage('Настоящий договор аренды помещения заключён между сторонами.'), 'ru');
    assert.equal(detectTtsLanguage('This agreement shall be governed by the laws of England and Wales.'), 'en');
    assert.equal(detectTtsLanguage('Dieser Vertrag unterliegt deutschem Recht, die Haftung ist beschränkt.'), 'de');
    assert.equal(detectTtsLanguage('يخضع هذا العقد لقوانين دولة الإمارات العربية المتحدة.'), 'ar');
    assert.equal(detectTtsLanguage('Ushbu shartnoma tomonlar oʻrtasida tuzildi va qonun bilan tartibga solinadi.'), 'uz');
    assert.equal(detectTtsLanguage('Осы шарт Қазақстан Республикасының заңнамасына сәйкес жасалды.'), 'kk');
    // Ложные срабатывания (находки адверсарной проверки):
    assert.equal(detectTtsLanguage("The meeting starts at nine o'clock at Diego's office."), 'en', 'английские притяжательные — не узбекский');
    assert.equal(detectTtsLanguage('Договор проверен по базе «Әділет» и признан действительным по праву РФ.'), 'ru', 'одна казахская буква в названии не перекрашивает русский текст');
  });

  it('режим аутентификации определяется по форме ключа', async () => {
    const { ttsAuthMode } = await import('../src/routes/tts.routes.ts');
    assert.equal(ttsAuthMode('{"type":"service_account"}'), 'service-account');
    assert.equal(ttsAuthMode('AIzaSyFakeKey123'), 'api-key');
  });

  it('обрезка не рвёт суррогатные пары (эмодзи)', async () => {
    const { clipTtsText } = await import('../src/routes/tts.routes.ts');
    const clipped = clipTtsText('🙂'.repeat(3000), 3800);
    assert.ok(Buffer.byteLength(clipped, 'utf8') <= 3800);
    assert.ok(clipped.length > 0);
    // encodeURIComponent бросает URIError на одиноком суррогате
    assert.doesNotThrow(() => encodeURIComponent(clipped), 'нет одиноких суррогатов на конце');
  });

  it('splitTtsChunks: первый кусок маленький, текст не теряется, эмодзи целы', async () => {
    const { splitTtsChunks } = await import('../src/lib/ttsStream.ts');
    assert.deepEqual(splitTtsChunks('Короткий текст.'), ['Короткий текст.']);
    const long = `Первое предложение. ${'Дальше идёт длинное предложение о существенных условиях договора и порядке расчётов между сторонами. '.repeat(15)}`;
    const chunks = splitTtsChunks(long);
    assert.ok(chunks.length >= 3, `ожидалось ≥3 кусков, получено ${chunks.length}`);
    assert.ok(chunks[0].length <= 90, 'первый кусок — короткий (быстрый старт)');
    const noSpace = (s: string) => s.replace(/\s+/g, '');
    assert.equal(chunks.map(noSpace).join(''), noSpace(long), 'ни один символ не потерян');
    // очень длинное первое предложение режется по запятой
    const commas = splitTtsChunks(`${'вводное слово, '.repeat(30)}конец первого. Второе предложение.`);
    assert.ok(commas[0].length <= 90);
    // эмодзи на границе первого куска не рвутся
    const emoji = splitTtsChunks(`${'🙂'.repeat(200)} и дальше обычный текст. Второе предложение.`);
    assert.doesNotThrow(() => encodeURIComponent(emoji.join('')), 'нет одиноких суррогатов');
    // предложение-монстр без знаков препинания НЕ должно дать кусок больше
    // лимита Cloud TTS в БАЙТАХ (иначе детерминированный 400 на каждом реплее)
    const monster = splitTtsChunks(`Начало. ${'б'.repeat(6000)} конец. Последнее предложение.`);
    for (const c of monster) {
      assert.ok(Buffer.byteLength(c, 'utf8') <= 3800, `кусок ${Buffer.byteLength(c, 'utf8')} байт > лимита`);
    }
  });

  it('markdown вычищается перед озвучкой (голос не читает «решётка, звёздочка»)', async () => {
    const { stripMarkdownForSpeech } = await import('../src/lib/ttsStream.ts');
    const md = '## Порядок определения долей\n\n**1. Супружеская доля** выделяется *до* определения массы.\n- пункт списка\n> цитата\nСсылка на [статью 1142](https://lex.uz/x) и `код`.\n\n```js\nconst x = 1;\n```\nКонец.';
    const clean = stripMarkdownForSpeech(md);
    assert.ok(!/[#*`>|]/.test(clean), `не осталось символов разметки: ${clean}`);
    assert.ok(clean.includes('Порядок определения долей'), 'текст заголовка сохранён');
    assert.ok(clean.includes('Супружеская доля'), 'жирный текст сохранён');
    assert.ok(clean.includes('статью 1142'), 'текст ссылки сохранён без URL');
    assert.ok(!clean.includes('https://'), 'URL не начитывается');
    assert.ok(!clean.includes('const x'), 'код-блок не начитывается');
  });

  it('юридические сокращения разворачиваются («ст.» не превращается в «стакан»)', async () => {
    const { normalizeLegalAbbrRu } = await import('../src/lib/ttsStream.ts');
    const out = normalizeLegalAbbrRu('Согласно ст. 1142 и п. 3 ч. 2 ГК РУз, а также ЗРУ-1137, т.е. новому закону об ООО.');
    assert.ok(out.includes('статья 1142'), out);
    assert.ok(out.includes('пункт 3'), out);
    assert.ok(out.includes('часть 2'), out);
    assert.ok(out.includes('гэ ка эр уз'), out);
    assert.ok(out.includes('зэ эр у 1137'), out);
    assert.ok(out.includes('то есть'), out);
    // «ст» без точки-цифры и обычные слова не трогаются
    const safe = normalizeLegalAbbrRu('Стороны стали строить статью правильно. Пропуск.');
    assert.equal(safe, 'Стороны стали строить статью правильно. Пропуск.');
  });

  it('номера норм «6.2» → «точка», даты и разряды не тронуты, резчик не рвёт числа', async () => {
    const { normalizeDottedNumbersRu, splitTtsChunks, stripMarkdownForSpeech } = await import('../src/lib/ttsStream.ts');
    assert.equal(normalizeDottedNumbersRu('пункт 6.2 договора'), 'пункт 6 точка 2 договора');
    assert.equal(normalizeDottedNumbersRu('пункт 6.2.1'), 'пункт 6 точка 2 точка 1');
    assert.equal(normalizeDottedNumbersRu('ст. 346.11 НК'), 'ст. 346 точка 11 НК');
    assert.equal(normalizeDottedNumbersRu('от 01.02.2026 года'), 'от 01.02.2026 года', 'дата не тронута');
    assert.equal(normalizeDottedNumbersRu('сумма 1.000.000 сум'), 'сумма 1.000.000 сум', 'разряды не тронуты');
    assert.equal(normalizeDottedNumbersRu('1. Первый пункт списка'), '1. Первый пункт списка', 'нумерация списка не тронута');
    // резчик: «6.2» не разрывается между «предложениями»
    const chunks = splitTtsChunks('Согласно статье 6.2 Закона стороны несут ответственность. Второе предложение для теста.');
    assert.ok(chunks.some((c) => c.includes('6.2')), `число целиком в одном куске: ${JSON.stringify(chunks)}`);
    // настоящая граница предложения после числа по-прежнему работает
    const real = splitTtsChunks('Договор действует 1142. Два года подряд без перерыва.');
    assert.ok(real[0].trimEnd().endsWith('1142.'), JSON.stringify(real));
    // дозакрытые дыры стрипа: разделители таблиц, маркер +, экранирование
    const table = stripMarkdownForSpeech('| Кол 1 | Кол 2 |\n| --- | :---: |\n| а | б |');
    assert.ok(!table.includes('-') && !table.includes(':'), `разделитель таблицы вычищен: ${table}`);
    assert.equal(stripMarkdownForSpeech('+ пункт списка'), 'пункт списка');
    assert.equal(stripMarkdownForSpeech('\\*важно\\*'), 'важно');
  });

  it('ensureSentenceBounds: строки получают точки, простыни режутся (Gemini 400 «sentences too long»)', async () => {
    const { ensureSentenceBounds } = await import('../src/lib/ttsStream.ts');
    // Строки таблицы/списка без точек — каждая становится предложением.
    const table = ensureSentenceBounds('Пеня 2% в день без ограничения\nОтветственность полностью исключена\nСрок до 31 декабря 2026 года');
    assert.equal(table, 'Пеня 2% в день без ограничения.\nОтветственность полностью исключена.\nСрок до 31 декабря 2026 года.');
    // Уже пунктуированный текст не трогается; «висящие» : и , не получают точку.
    assert.equal(ensureSentenceBounds('Первое. Второе!\nСтороны:\nодна, вторая,'), 'Первое. Второе!\nСтороны:\nодна, вторая,');
    // Прогон в 500 символов без точек режется: не остаётся кусков длиннее лимита.
    const run = ensureSentenceBounds(`${'слово '.repeat(40)}, ${'дело '.repeat(40)}`.trim(), 220);
    for (const part of run.split(/[.!?]/)) {
      assert.ok(part.trim().length <= 220, `кусок ≤220: ${part.trim().length}`);
    }
    // Короткий текст с точкой — байт в байт без изменений.
    assert.equal(ensureSentenceBounds('Проверка озвучки.'), 'Проверка озвучки.');
  });

  it('находки финального аудита: нег-кэш только языковых 400, Заглавные сокращения, резчик и стрип', async () => {
    const { isLanguageArgumentError, TtsUpstreamError, normalizeLegalAbbrRu, splitTtsChunks, stripMarkdownForSpeech, hardSplitByBytes } = await import('../src/lib/ttsStream.ts');
    // H1: не-языковой 400 (текст-зависимый) НЕ должен отравлять кэш на сутки
    assert.equal(isLanguageArgumentError(new TtsUpstreamError(400, 'HTTP 400: unsupported language code')), true);
    assert.equal(isLanguageArgumentError(new TtsUpstreamError(400, 'HTTP 400: Invalid prompt content')), false);
    assert.equal(isLanguageArgumentError(new TtsUpstreamError(429, 'unsupported language code')), false);
    // M4: сокращения с Заглавной (начало предложения)
    assert.ok(normalizeLegalAbbrRu('Ст. 5 применяется всегда.').startsWith('статья 5'), 'Ст. → статья');
    assert.ok(normalizeLegalAbbrRu('Т.е. немедленно.').startsWith('то есть'), 'Т.е. → то есть');
    assert.ok(normalizeLegalAbbrRu('П. 3 обязателен.').startsWith('пункт 3'), 'П. → пункт');
    // L7: «1.» нумерации не становится отдельным первым куском
    const listChunks = splitTtsChunks('1. Первый пункт списка важен. 2. Второй пункт тоже важен.');
    assert.notEqual(listChunks[0].trim(), '1.', JSON.stringify(listChunks));
    // L8: экранированное «6\\.2» не разрывается пробелом
    assert.equal(stripMarkdownForSpeech('Пункт 6\\.2 договора'), 'Пункт 6.2 договора');
    // L5: hardSplitByBytes гарантированно завершается на крошечных лимитах
    assert.ok(Array.isArray(hardSplitByBytes('😀😀😀', 2)), 'нет вечного цикла');
  });

  it('кэш отказов: мягкие (таймаут) не выключают язык без Chirp-фолбэка', async () => {
    const { negCacheLang, isLangNegCached, resetTtsStreamForTests } = await import('../src/lib/ttsStream.ts');
    resetTtsStreamForTests();
    try {
      negCacheLang('gemini-x', 'kk-KZ', 60_000, false); // мягкая запись (деградация)
      assert.equal(isLangNegCached('gemini-x', 'kk-KZ', true), true, 'обычный проход пропускает');
      assert.equal(isLangNegCached('gemini-x', 'kk-KZ', false), false, 'спасательный проход — пробует');
      negCacheLang('gemini-y', 'uz-UZ'); // жёсткая (языковой 400, сутки)
      assert.equal(isLangNegCached('gemini-y', 'uz-UZ', false), true, 'жёсткая запись держится всегда');
    } finally {
      resetTtsStreamForTests();
    }
  });

  it('auth-кэш TTS: 30-сек кэш работает и мгновенно инвалидируется', async () => {
    const { invalidateTtsAuthCache } = await import('../src/plugins/auth.ts');
    const u = await makeUser();
    const ok1 = await app.inject({ method: 'POST', url: '/api/tts', headers: auth(u.token), payload: { text: 'Кэш раз.' } });
    assert.equal(ok1.statusCode, 200, ok1.body);
    // Отзываем сессию прямо в БД: без кэша следующий запрос был бы 401
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [u.id]);
    const cachedOk = await app.inject({ method: 'POST', url: '/api/tts', headers: auth(u.token), payload: { text: 'Кэш два.' } });
    assert.equal(cachedOk.statusCode, 200, 'в 30-сек окне кэша запрос ещё проходит');
    invalidateTtsAuthCache(u.id);
    const revoked = await app.inject({ method: 'POST', url: '/api/tts', headers: auth(u.token), payload: { text: 'Кэш три.' } });
    assert.equal(revoked.statusCode, 401, 'после инвалидации отзыв мгновенный');
  });

  it('срезка ID3: заголовок (и footer) у начала, ID3v1-хвост, чужое не трогаем', async () => {
    const { stripLeadingId3, stripTrailingId3v1 } = await import('../src/lib/ttsStream.ts');
    const payload = Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
    assert.ok(stripLeadingId3(withId3(16, payload)).equals(payload), 'обычный тег срезан');
    assert.ok(stripLeadingId3(withId3(16, payload, true)).equals(payload), 'тег с footer срезан целиком');
    assert.ok(stripLeadingId3(payload).equals(payload), 'без тега — без изменений');
    const v1 = Buffer.concat([payload, Buffer.from('TAG', 'latin1'), Buffer.alloc(125, 2)]);
    assert.ok(stripTrailingId3v1(v1).equals(payload), 'ID3v1-хвост срезан');
    assert.ok(stripTrailingId3v1(payload).equals(payload));
  });

  it('stream: 401 без токена, 400 на пустой текст', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/tts/stream', payload: { text: 'Привет' } });
    assert.equal(anon.statusCode, 401);
    const u = await makeUser();
    const empty = await app.inject({ method: 'POST', url: '/api/tts/stream', headers: auth(u.token), payload: { text: '   ' } });
    assert.equal(empty.statusCode, 400);
  });

  it('stream: конвейер по кускам, склейка со срезкой ID3, честный 502 при полном отказе', async () => {
    const { resetTtsStreamForTests } = await import('../src/lib/ttsStream.ts');
    resetTtsStreamForTests();
    const u = await makeUser();
    const text = `Первое предложение короткое. ${'Дальше идёт длинная часть текста, которая обязана уехать во второй кусок конвейера синтеза речи. '.repeat(3)}`;

    const p1 = Buffer.from('AAAA-mp3-first-chunk');
    const p2 = Buffer.from('BBBB-mp3-second-chunk');
    synthCalls = [];
    audioQueue = [withId3(16, p1), withId3(24, p2)];
    try {
      const res = await app.inject({ method: 'POST', url: '/api/tts/stream', headers: auth(u.token), payload: { text } });
      assert.equal(res.statusCode, 200, res.body?.slice?.(0, 200));
      assert.equal(res.headers['content-type'], 'audio/mpeg');
      assert.equal(synthCalls.length, 2, 'два куска — ровно два вызова Google');
      assert.ok(String(synthCalls[0].input.text).length <= 90, 'первый кусок маленький (быстрый старт)');
      // Склейка: 1-й кусок целиком, у 2-го срезан ведущий ID3-тег.
      const expected = Buffer.concat([withId3(16, p1), p2]);
      assert.ok(res.rawPayload.equals(expected), 'payload = кусок1 + кусок2 без ID3');

      // Полный отказ синтеза (первый кусок не собрался) → честный HTTP 502.
      failModels = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-tts'];
      failCodes = ['ru-RU']; // валит и Chirp-шаг
      const dead = await app.inject({ method: 'POST', url: '/api/tts/stream', headers: auth(u.token), payload: { text: 'Проверка отказа.' } });
      assert.equal(dead.statusCode, 502);
    } finally {
      audioQueue = [];
      failModels = [];
      failCodes = [];
      resetTtsStreamForTests();
    }
  });

  it('негативный кэш: uz-UZ после 400 сутки не переспрашивается', async () => {
    const { resetTtsStreamForTests } = await import('../src/lib/ttsStream.ts');
    resetTtsStreamForTests();
    const u = await makeUser();
    const uzText = 'Ushbu shartnoma tomonlar oʻrtasida tuzildi va qonun bilan tartibga solinadi.';
    failCodes = ['uz-UZ'];
    try {
      synthCalls = [];
      const r1 = await app.inject({ method: 'POST', url: '/api/tts', headers: auth(u.token), payload: { text: uzText } });
      assert.equal(r1.statusCode, 200, r1.body);
      assert.equal(synthCalls[0].voice.languageCode, 'uz-UZ', 'первая попытка — честный код');
      assert.equal(synthCalls[1].voice.languageCode, 'en-US', 'второй кандидат сработал');
      synthCalls = [];
      const r2 = await app.inject({ method: 'POST', url: '/api/tts', headers: auth(u.token), payload: { text: uzText } });
      assert.equal(r2.statusCode, 200, r2.body);
      assert.equal(synthCalls[0].voice.languageCode, 'en-US', 'uz-UZ пропущен по негативному кэшу');
    } finally {
      failCodes = [];
      resetTtsStreamForTests();
    }
  });
});

describe('projects (дела юристов)', () => {
  it('CRUD проекта доступен Free-пользователю; чужой проект = 404', async () => {
    const u = await makeUser(); // Free — проекты для всех
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: auth(u.token), payload: { name: 'Дело: ООО «Ромашка»' } });
    assert.equal(created.statusCode, 201, created.body);
    const proj = JSON.parse(created.body);
    assert.equal(proj.name, 'Дело: ООО «Ромашка»');
    assert.equal(proj.docsCount, 0);

    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/projects', headers: auth(u.token) })).body);
    assert.equal(list.length, 1);

    const renamed = await app.inject({ method: 'PATCH', url: `/api/projects/${proj.id}`, headers: auth(u.token), payload: { name: 'Дело: аренда' } });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(JSON.parse(renamed.body).name, 'Дело: аренда');

    // Чужой пользователь проект не видит и не правит.
    const stranger = await makeUser();
    const foreign = await app.inject({ method: 'PATCH', url: `/api/projects/${proj.id}`, headers: auth(stranger.token), payload: { name: 'x' } });
    assert.equal(foreign.statusCode, 404);
    const foreignDel = await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}`, headers: auth(stranger.token) });
    assert.equal(foreignDel.statusCode, 404);

    const del = await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}`, headers: auth(u.token) });
    assert.equal(del.statusCode, 204);
    assert.equal(JSON.parse((await app.inject({ method: 'GET', url: '/api/projects', headers: auth(u.token) })).body).length, 0);
  });

  it('документ переносится в проект, фильтруется по нему, а удаление проекта возвращает документ в общий список', async () => {
    const u = await makeUser();
    const proj = JSON.parse((await app.inject({ method: 'POST', url: '/api/projects', headers: auth(u.token), payload: { name: 'Дело' } })).body);
    // Документ напрямую в БД (как в других тестах — без полного цикла анализа).
    const docId = `doc_proj_${Date.now()}`;
    await db.query(
      "INSERT INTO documents (id, user_id, name, status, risk) VALUES ($1, $2, 'proj-doc.pdf', 'Reviewed', 'Low')",
      [docId, u.id],
    );
    // Перенос в проект.
    const moved = await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: proj.id } });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(JSON.parse(moved.body).projectId, proj.id);
    // Чужой проект в projectId → 404, документ не трогается.
    const stranger = await makeUser();
    const strangerProj = JSON.parse((await app.inject({ method: 'POST', url: '/api/projects', headers: auth(stranger.token), payload: { name: 'Чужое' } })).body);
    const cross = await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: strangerProj.id } });
    assert.equal(cross.statusCode, 404, 'чужой проект недоступен');
    // Фильтры списка.
    const inProj = JSON.parse((await app.inject({ method: 'GET', url: `/api/documents?project=${proj.id}`, headers: auth(u.token) })).body);
    assert.equal(inProj.length, 1);
    assert.equal(inProj[0].id, docId);
    const outside = JSON.parse((await app.inject({ method: 'GET', url: '/api/documents?project=none', headers: auth(u.token) })).body);
    assert.ok(!outside.some((d: { id: string }) => d.id === docId), 'внутри проекта — не в общем списке при project=none');
    // Счётчик в списке проектов.
    const plist = JSON.parse((await app.inject({ method: 'GET', url: '/api/projects', headers: auth(u.token) })).body);
    assert.equal(plist.find((p: { id: string }) => p.id === proj.id)?.docsCount, 1);
    // Удаление проекта возвращает документ в общий список (не удаляет его).
    await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}`, headers: auth(u.token) });
    const back = JSON.parse((await app.inject({ method: 'GET', url: '/api/documents?project=none', headers: auth(u.token) })).body);
    assert.ok(back.some((d: { id: string }) => d.id === docId), 'документ жив и вернулся в общий список');
    // Вынос из проекта значением null тоже работает.
    const proj2 = JSON.parse((await app.inject({ method: 'POST', url: '/api/projects', headers: auth(u.token), payload: { name: 'Д2' } })).body);
    await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: proj2.id } });
    const unset = await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: null } });
    assert.equal(unset.statusCode, 200);
    assert.equal(JSON.parse(unset.body).projectId, null);
    // Пустая/пробельная строка = вынос (null), а не FK-нарушение → 500.
    await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: proj2.id } });
    const empty = await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: '' } });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(JSON.parse(empty.body).projectId, null, 'пустая строка = убрать из дела');
    const spaces = await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(u.token), payload: { projectId: '   ' } });
    assert.equal(spaces.statusCode, 200, 'пробелы не роняют в 500');
  });

  it('project_id владельца НЕ утекает участнику команды через GET /documents/:id', async () => {
    const owner = await makeUser();
    await db.query("UPDATE subscriptions SET plan = 'Business' WHERE user_id = $1", [owner.id]); // team — Business
    const proj = JSON.parse((await app.inject({ method: 'POST', url: '/api/projects', headers: auth(owner.token), payload: { name: 'Тайное дело' } })).body);
    const docId = `doc_leak_${Date.now()}`;
    await db.query("INSERT INTO documents (id, user_id, name, status, risk, team_shared) VALUES ($1,$2,'shared.pdf','Reviewed','Low', true)", [docId, owner.id]);
    await app.inject({ method: 'PATCH', url: `/api/documents/${docId}`, headers: auth(owner.token), payload: { projectId: proj.id } });
    // Участник команды (viewer) видит документ, но НЕ его project_id.
    const member = await makeUser();
    await db.query(
      "INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status) VALUES ($1,$2,$3,'M',$4,'viewer','active')",
      [`tm_leak_${counter++}`, owner.id, member.id, member.email],
    );
    const asMember = await app.inject({ method: 'GET', url: `/api/documents/${docId}`, headers: auth(member.token) });
    assert.equal(asMember.statusCode, 200, asMember.body);
    assert.equal(JSON.parse(asMember.body).projectId, null, 'project_id владельца скрыт от участника');
    // Владелец своё дело видит.
    const asOwner = await app.inject({ method: 'GET', url: `/api/documents/${docId}`, headers: auth(owner.token) });
    assert.equal(JSON.parse(asOwner.body).projectId, proj.id, 'владелец видит своё дело');
  });
});

describe('документ = конкретный файл, а не имя (аудит загрузок 2026-10-18)', () => {
  async function uploadText(token: string, name: string, content: string): Promise<string> {
    const boundary = '----lexabSameNameBoundary';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        `Content-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body).id;
  }
  async function analyze(token: string, payload: Record<string, unknown>): Promise<{ id: string; documentId: string }> {
    const res = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(token), payload: { fileSize: '1 KB', jurisdiction: 'GB', ...payload } });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body);
  }
  const uploadOf = async (analysisId: string) =>
    (await db.query<{ upload_id: string }>('SELECT upload_id FROM analyses WHERE id = $1', [analysisId])).rows[0].upload_id;

  it('два разных договора с одним именем — две карточки, у каждой свой файл', async () => {
    const u = await makeProUser();
    const upA = await uploadText(u.token, 'Договор.txt', 'Договор поставки цемента с ООО «Альфа». Цена 100 000 000 сум.');
    const anA = await analyze(u.token, { fileName: 'Договор.txt', uploadId: upA });
    const upB = await uploadText(u.token, 'Договор.txt', 'Договор аренды склада с ООО «Бета». Аренда 5 000 000 сум в месяц.');
    const anB = await analyze(u.token, { fileName: 'Договор.txt', uploadId: upB });
    assert.notEqual(anB.documentId, anA.documentId, 'чужой договор не ложится в карточку тёзки');
    assert.equal(await uploadOf(anA.id), upA);
    assert.equal(await uploadOf(anB.id), upB);
    const docs = JSON.parse((await app.inject({ method: 'GET', url: '/api/documents', headers: auth(u.token) })).body) as { name: string }[];
    assert.equal(docs.filter((d) => d.name === 'Договор.txt').length, 2, 'в «Документах» две карточки');
  });

  it('тот же файл, загруженный заново, — та же карточка (без дублей)', async () => {
    const u = await makeProUser();
    const text = 'Договор подряда с ИП Каримов. Срок выполнения работ 30 календарных дней.';
    const an1 = await analyze(u.token, { fileName: 'Подряд.txt', uploadId: await uploadText(u.token, 'Подряд.txt', text) });
    const an2 = await analyze(u.token, { fileName: 'Подряд.txt', uploadId: await uploadText(u.token, 'Подряд.txt', text) });
    assert.equal(an2.documentId, an1.documentId);
  });

  it('повторный анализ остаётся в своём документе, даже когда есть свежий тёзка', async () => {
    const u = await makeProUser();
    const anA = await analyze(u.token, { fileName: 'Соглашение.txt', uploadId: await uploadText(u.token, 'Соглашение.txt', 'Соглашение о конфиденциальности, сторона А.') });
    const anB = await analyze(u.token, { fileName: 'Соглашение.txt', uploadId: await uploadText(u.token, 'Соглашение.txt', 'Соглашение о сотрудничестве, сторона Б.') });
    const again = await analyze(u.token, { analysisId: anA.id, force: true });
    assert.equal(again.documentId, anA.documentId, 'новый разбор договора А не уехал в карточку Б');
    assert.notEqual(again.documentId, anB.documentId);
  });

  it('согласование показывает СВОЙ договор, а не одноимённого соседа', async () => {
    const u = await makeProUser();
    const anA = await analyze(u.token, { fileName: 'Оферта.txt', uploadId: await uploadText(u.token, 'Оферта.txt', 'Оферта на поставку, версия А.') });
    const anB = await analyze(u.token, { fileName: 'Оферта.txt', uploadId: await uploadText(u.token, 'Оферта.txt', 'Оферта на услуги, версия Б.') });
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/analysis/${anB.id}/document`,
      headers: auth(u.token),
      payload: { document: [{ type: 'paragraph', segments: ['ТЕКСТ СОСЕДНЕГО ДОГОВОРА Б'] }] },
    });
    assert.equal(edit.statusCode, 200, edit.body);
    const flow = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: auth(u.token),
      payload: { documentId: anA.documentId, steps: [{ name: 'Партнёр', email: 'appr@firm.com' }] },
    });
    assert.equal(flow.statusCode, 201, flow.body);
    const page = await app.inject({ method: 'GET', url: `/api/approve/${JSON.parse(flow.body).steps[0].token}` });
    assert.equal(page.statusCode, 200, page.body);
    const text = JSON.parse(page.body).documentText as string;
    assert.ok(text && !text.includes('ТЕКСТ СОСЕДНЕГО ДОГОВОРА Б'), 'согласующий видит договор А');
  });

  it('договор из входящей почты привязан к своей загрузке, а не к тёзке', async () => {
    const { config } = await import('../src/config.ts');
    const saved = { token: config.inboundEmailToken, auth: config.inboundRequireAuth, sign: config.inboundEmailSigningSecret };
    Object.assign(config, { inboundEmailToken: 'inbound-test-token', inboundRequireAuth: false, inboundEmailSigningSecret: '' });
    try {
      const u = await makeProUser();
      const manual = await analyze(u.token, { fileName: 'Договор.txt', uploadId: await uploadText(u.token, 'Договор.txt', 'Договор, загруженный вручную.') });
      const res = await app.inject({
        method: 'POST',
        url: '/api/inbound/email',
        headers: { 'x-inbound-token': 'inbound-test-token' },
        payload: {
          from: u.email,
          attachments: [{ filename: 'Договор.txt', contentBase64: Buffer.from('Другой договор, пришедший письмом от контрагента.').toString('base64') }],
        },
      });
      assert.ok(res.statusCode < 300, res.body);
      const analysisId = JSON.parse(res.body).results?.[0]?.analysisId as string;
      assert.ok(analysisId, res.body);
      assert.ok(await uploadOf(analysisId), 'у разбора из почты есть upload_id');
      const doc = (await db.query<{ document_id: string }>('SELECT document_id FROM analyses WHERE id = $1', [analysisId])).rows[0].document_id;
      assert.notEqual(doc, manual.documentId, 'письмо не легло в карточку ручного договора');
    } finally {
      Object.assign(config, { inboundEmailToken: saved.token, inboundRequireAuth: saved.auth, inboundEmailSigningSecret: saved.sign });
    }
  });
});

describe('«Весь договор» — полный текст файла с принятыми правками (аудит загрузок 2026-10-18)', () => {
  async function uploadText(token: string, name: string, content: string): Promise<string> {
    const boundary = '----lexabFullTextBoundary';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        `Content-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body).id;
  }

  it('показывает ВЕСЬ договор, а не только пункты с правками; принятые правки — внутри текста', async () => {
    const u = await makeProUser();
    // Тестовая «модель» предлагает правки r1 («one (1) week's» → «one (1) month's»)
    // и r3 (её формулировки в тексте нет — она должна попасть в список «не встали»).
    const contract = [
      '1. Parties. This agreement is made between Alpha LLC and Beta LLC.',
      "2. Termination. Either party may terminate on one (1) week's written notice.",
      '3. Payment. The price is 100 000 USD payable within 10 banking days.',
      '4. Governing law. This agreement is governed by the laws of England.',
    ].join('\n\n');
    const uploadId = await uploadText(u.token, 'full-contract.txt', contract);
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: 'full-contract.txt', fileSize: '1 KB', jurisdiction: 'GB', uploadId },
    });
    assert.equal(an.statusCode, 201, an.body);
    const analysis = JSON.parse(an.body) as { id: string; documentId: string };
    for (const rid of ['r1', 'r3']) {
      const ok = await app.inject({ method: 'PATCH', url: `/api/analysis/${analysis.id}/redlines/${rid}`, headers: auth(u.token), payload: { status: 'accepted' } });
      assert.equal(ok.statusCode, 200, ok.body);
    }

    const res = await app.inject({ method: 'GET', url: `/api/analysis/${analysis.id}/full-text`, headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const full = JSON.parse(res.body) as { text: string; fromFile: boolean; recognizedByAi: boolean; unapplied: { id: string }[] };
    assert.equal(full.fromFile, true);
    assert.equal(full.recognizedByAi, false);
    for (const clause of ['1. Parties.', '3. Payment. The price is 100 000 USD', '4. Governing law.']) {
      assert.ok(full.text.includes(clause), `пункт без правок тоже на месте: ${clause}`);
    }
    assert.ok(full.text.includes("one (1) month's written notice"), 'принятая правка вставлена в текст');
    assert.ok(!full.text.includes("one (1) week's"), 'старая формулировка заменена');
    assert.deepEqual(full.unapplied.map((r) => r.id), ['r3'], 'не найденная в тексте правка — в отдельном списке');

    // Что на экране, то и в файле: «чистый» экспорт несёт тот же текст.
    const exp = await app.inject({
      method: 'POST',
      url: `/api/documents/${analysis.documentId}/export`,
      headers: auth(u.token),
      payload: { format: 'pdf' },
    });
    assert.equal(exp.statusCode, 200, exp.body);
    const { extractText } = await import('../src/extract.ts');
    const exported = await extractText(Buffer.from(exp.rawPayload), 'export.pdf');
    for (const clause of ['3. Payment.', "one (1) month's written notice"]) {
      assert.ok(exported?.includes(clause), `экспорт содержит: ${clause}`);
    }
  });

  it('согласующий видит ВЕСЬ договор и только ПРИНЯТЫЕ правки (решение владельца 2026-10-18)', async () => {
    const u = await makeProUser();
    const contract = [
      '1. Parties. This agreement is made between Alpha LLC and Beta LLC.',
      "2. Termination. Either party may terminate on one (1) week's written notice.",
      '3. Non-compete. The employee shall not compete for twelve (12) months after termination.',
      '4. Governing law. This agreement is governed by the laws of England.',
    ].join('\n\n');
    const uploadId = await uploadText(u.token, 'approval-contract.txt', contract);
    const an = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'approval-contract.txt', fileSize: '1 KB', jurisdiction: 'GB', uploadId } })).body,
    ) as { id: string; documentId: string };
    // r1 принята владельцем, r2 («twelve (12) months» → «six (6) months») — ещё нет.
    await app.inject({ method: 'PATCH', url: `/api/analysis/${an.id}/redlines/r1`, headers: auth(u.token), payload: { status: 'accepted' } });
    const flow = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: auth(u.token),
      payload: { documentId: an.documentId, steps: [{ name: 'Партнёр', email: 'partner@firm.com' }] },
    });
    assert.equal(flow.statusCode, 201, flow.body);
    const page = JSON.parse((await app.inject({ method: 'GET', url: `/api/approve/${JSON.parse(flow.body).steps[0].token}` })).body);
    const text = page.documentText as string;
    for (const clause of ['1. Parties.', '4. Governing law.']) assert.ok(text.includes(clause), `пункт без правок на месте: ${clause}`);
    assert.ok(text.includes("one (1) month's written notice"), 'принятая правка вставлена');
    assert.ok(text.includes('twelve (12) months'), 'непринятое предложение ИИ не выдаётся за текст договора');
    assert.ok(!text.includes('six (6) months'), 'непринятая формулировка ИИ в тексте отсутствует');
  });

  it('договор, сгенерированный по запросу (без файла): fromFile=false — его документ и есть весь договор', async () => {
    const u = await makeProUser();
    const draft = await app.inject({ method: 'POST', url: '/api/analysis/draft', headers: auth(u.token), payload: { prompt: 'Договор оказания услуг по уборке офиса' } });
    assert.equal(draft.statusCode, 201, draft.body);
    const res = await app.inject({ method: 'GET', url: `/api/analysis/${JSON.parse(draft.body).id}/full-text`, headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const full = JSON.parse(res.body);
    assert.equal(full.text, null);
    assert.equal(full.fromFile, false);
  });

  it('скачанный Word из PDF — абзацы целиком, а не строка страницы на абзац', async () => {
    const u = await makeProUser();
    const { buildSimplePdf } = await import('../src/lib/pdf.ts');
    const sentence =
      'Поставщик обязуется поставить Покупателю цемент марки М400 в количестве и в сроки, согласованные сторонами в спецификациях, являющихся неотъемлемой частью настоящего договора, а Покупатель обязуется принять и оплатить товар.';
    const pdf = await buildSimplePdf('Договор поставки', [{ heading: '1. ПРЕДМЕТ ДОГОВОРА' }, { text: `1.1. ${sentence}` }, { text: '1.2. Срок поставки — 30 дней.' }]);
    const boundary = '----lexabReflowBoundary';
    const up = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reflow.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        pdf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    assert.equal(up.statusCode, 201, up.body);
    const an = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'reflow.pdf', fileSize: '5 KB', jurisdiction: 'UZ', uploadId: JSON.parse(up.body).id } })).body,
    ) as { id: string; documentId: string };
    const exp = await app.inject({
      method: 'POST',
      url: `/api/documents/${an.documentId}/export`,
      headers: auth(u.token),
      payload: { format: 'docx', mode: 'clean' },
    });
    assert.equal(exp.statusCode, 200, exp.body);
    const mammoth = await import('mammoth');
    const paras = (await mammoth.extractRawText({ buffer: Buffer.from(exp.rawPayload) })).value.split('\n').filter((l) => l.trim());
    assert.ok(paras.includes(`1.1. ${sentence}`), `пункт 1.1 — одним абзацем:\n${paras.join('\n')}`);
    assert.ok(paras.includes('1.2. Срок поставки — 30 дней.'), paras.join('\n'));
    assert.ok(!paras.some((p) => /-- \d+ of \d+ --/.test(p)), 'служебных пометок страниц нет');
  });

  it('договор, созданный по запросу: в «Весь договор» и в скачивании нет ни чужого текста одноимённого файла, ни ложной пометки', async () => {
    const u = await makeProUser();
    const draft = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/analysis/draft', headers: auth(u.token), payload: { prompt: 'Договор оказания услуг по уборке офиса' } })).body,
    ) as { id: string; documentId: string; fileName: string };
    // Загружен файл с ТЕМ ЖЕ названием, что у черновика, — с чужим текстом.
    const boundary = '----lexabDraftNameBoundary';
    await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${draft.fileName}"\r\nContent-Type: text/plain\r\n\r\nЧУЖОЙ ДОГОВОР АРЕНДЫ, совсем другой текст.\r\n--${boundary}--\r\n`,
      ),
    });
    const full = JSON.parse((await app.inject({ method: 'GET', url: `/api/analysis/${draft.id}/full-text`, headers: auth(u.token) })).body);
    assert.equal(full.text, null, 'черновик не подменён одноимённым файлом');
    assert.equal(full.fromFile, false);
    const exp = await app.inject({ method: 'POST', url: `/api/documents/${draft.documentId}/export`, headers: auth(u.token), payload: { format: 'docx', mode: 'clean' } });
    const mammoth = await import('mammoth');
    const text = (await mammoth.extractRawText({ buffer: Buffer.from(exp.rawPayload) })).value;
    assert.ok(!text.includes('ЧУЖОЙ ДОГОВОР'), text);
    assert.ok(!/отсутствует в хранилище|no longer in storage/.test(text), 'у черновика нет исходного файла — и пометки нет');
    // И чат по черновику не получает чужой текст как «полный текст договора».
    const { buildAnalysisContext } = await import('../src/routes/chats.routes.ts');
    const ctx = (await buildAnalysisContext(db, u.id, draft.id)) ?? '';
    assert.ok(!ctx.includes('ЧУЖОЙ ДОГОВОР'), ctx);
  });

  it('ручные правки пунктов попадают в «Весь договор», скачанный Word и согласование', async () => {
    const u = await makeProUser();
    // Договор, в котором дословно стоят пункты, которые цитирует тестовая «модель».
    const contract = [
      '1. Parties. This agreement is made between Alpha LLC and Beta LLC.',
      '5. Termination',
      "Either party may terminate this Agreement by giving one (1) week's written notice to the other. Upon termination, the Employee shall promptly return all Company property and confidential materials.",
      '8. Post-Termination Restrictions',
      'The Employee shall not, for a period of twelve (12) months following the Termination Date, solicit or entice away any client with whom the Employee dealt during the twelve (12) months prior to termination.',
      '12. Governing law. This agreement is governed by the laws of England.',
    ].join('\n\n');
    const uploadId = await uploadText(u.token, 'manual-edits.txt', contract);
    const an = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'manual-edits.txt', fileSize: '1 KB', jurisdiction: 'GB', uploadId } })).body,
    ) as { id: string; documentId: string; document: { type: string; text?: string; segments?: unknown[] }[] };
    await app.inject({ method: 'PATCH', url: `/api/analysis/${an.id}/redlines/r1`, headers: auth(u.token), payload: { status: 'accepted' } });

    const doc = an.document.map((b) => ({ ...b }));
    const patch = (document: unknown) => app.inject({ method: 'PATCH', url: `/api/analysis/${an.id}/document`, headers: auth(u.token), payload: { document } });
    // 1-я правка: юрист дописал условие в пункт о расторжении (слот правки ИИ на месте).
    doc[1] = { ...doc[1], segments: [...(doc[1].segments ?? []), ' Notice must be sent by registered mail.'] };
    // Пункт про отпуск в этом договоре отсутствует — его правка не найдётся.
    doc[5] = { ...doc[5], segments: [...(doc[5].segments ?? []), ' Plus two extra days.'] };
    assert.equal((await patch(doc)).statusCode, 200);
    // 2-я правка: дописал ещё и переписал пункт 8 целиком — предложение ИИ из него ушло.
    doc[1] = { ...doc[1], segments: [...(doc[1].segments ?? []), { text: ' Or by courier.', marks: ['b'] }] };
    doc[3] = { type: 'paragraph', segments: ['The Employee shall not solicit any client for six (6) months after termination.'] };
    assert.equal((await patch(doc)).statusCode, 200);

    const full = JSON.parse((await app.inject({ method: 'GET', url: `/api/analysis/${an.id}/full-text`, headers: auth(u.token) })).body) as {
      text: string;
      unplacedEdits: { was: string; now: string }[];
    };
    assert.ok(
      full.text.includes("by giving one (1) month's written notice to the other. Upon termination, the Employee shall promptly return all Company property and confidential materials. Notice must be sent by registered mail. Or by courier."),
      full.text,
    );
    assert.ok(full.text.includes('The Employee shall not solicit any client for six (6) months after termination.'), 'пункт 8 переписан целиком');
    assert.ok(!full.text.includes('solicit or entice away'), 'старая редакция пункта 8 ушла');
    assert.ok(full.text.includes('1. Parties.') && full.text.includes('12. Governing law.'), 'остальной договор на месте');
    assert.equal(full.unplacedEdits.length, 1, 'ненайденная правка — в списке «внесите вручную»');
    assert.match(full.unplacedEdits[0].now, /Plus two extra days\./);

    const exp = await app.inject({ method: 'POST', url: `/api/documents/${an.documentId}/export`, headers: auth(u.token), payload: { format: 'docx', mode: 'clean' } });
    const mammoth = await import('mammoth');
    const word = (await mammoth.extractRawText({ buffer: Buffer.from(exp.rawPayload) })).value;
    assert.ok(word.includes('Notice must be sent by registered mail. Or by courier.'), 'ручная правка в скачанном «чистом» Word');
    assert.ok(word.includes('Plus two extra days.'), 'ненайденная — видимой припиской «внесите вручную»');

    const flow = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: auth(u.token),
      payload: { documentId: an.documentId, steps: [{ name: 'Партнёр', email: 'partner@firm.com' }] },
    });
    const page = JSON.parse((await app.inject({ method: 'GET', url: `/api/approve/${JSON.parse(flow.body).steps[0].token}` })).body);
    assert.ok((page.documentText as string).includes('Notice must be sent by registered mail. Or by courier.'), 'согласующий видит ручную правку');
  });

  it('чужой разбор не отдаётся', async () => {
    const owner = await makeProUser();
    const stranger = await makeUser();
    const uploadId = await uploadText(owner.token, 'secret.txt', 'Secret contract between Alpha and Beta, price 1 USD.');
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(owner.token), payload: { fileName: 'secret.txt', fileSize: '1 KB', jurisdiction: 'GB', uploadId } });
    const res = await app.inject({ method: 'GET', url: `/api/analysis/${JSON.parse(an.body).id}/full-text`, headers: auth(stranger.token) });
    assert.equal(res.statusCode, 404, res.body);
  });
});

describe('.doc (Word 97–2003) через загрузку — аудит загрузок 2026-10-18', () => {
  async function upload(token: string, name: string, data: Buffer) {
    const boundary = '----lexabDocBoundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/msword\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  }

  it('.doc загружается с текстом и разбирается', async () => {
    const u = await makeProUser();
    const res = await upload(u.token, 'Договор поставки.doc', fs.readFileSync(new URL('./fixtures/dogovor-ru-uz.doc', import.meta.url)));
    assert.equal(res.statusCode, 201, res.body);
    const up = JSON.parse(res.body) as { id: string; fileName: string };
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: up.fileName, fileSize: '19 KB', jurisdiction: 'UZ', uploadId: up.id },
    });
    assert.equal(an.statusCode, 201, an.body);
    const full = JSON.parse((await app.inject({ method: 'GET', url: `/api/analysis/${JSON.parse(an.body).id}/full-text`, headers: auth(u.token) })).body);
    assert.ok(full.text?.includes('неустойку 0,5% за каждый день'), JSON.stringify(full));
  });

  it('.doc под паролем — сразу отказ с подсказкой, на сервере ничего не остаётся', async () => {
    const u = await makeProUser();
    const doc = Buffer.from(fs.readFileSync(new URL('./fixtures/dogovor-ru-uz.doc', import.meta.url)));
    let fib = -1;
    for (let off = 512; off + 512 <= doc.length && fib < 0; off += 512) if (doc.readUInt16LE(off) === 0xa5ec) fib = off;
    doc.writeUInt16LE(doc.readUInt16LE(fib + 0x0a) | 0x0100, fib + 0x0a); // fEncrypted
    const res = await upload(u.token, 'Секретный.doc', doc);
    assert.equal(res.statusCode, 400, res.body);
    assert.match(JSON.parse(res.body).error ?? res.body, /паролем/);
    const rows = await db.query('SELECT 1 FROM uploads WHERE user_id = $1', [u.id]);
    assert.equal(rows.rows.length, 0, 'файл не сохранён и не занимает место');
  });
});

describe('загрузки-«сироты» — аудит загрузок 2026-10-18', () => {
  it('удаляется только старая загрузка, на которую ничто не ссылается; нужные — на месте', async () => {
    const { purgeOrphanUploads } = await import('../src/routes/documents.routes.ts');
    const { readFileBytes } = await import('../src/storage.ts');
    const u = await makeProUser();
    const boundary = '----lexabOrphanBoundary';
    const upload = async (name: string, text: string): Promise<string> => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { ...auth(u.token), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`),
      });
      assert.equal(res.statusCode, 201, res.body);
      return JSON.parse(res.body).id;
    };
    const orphan = await upload('сорвался.txt', 'Договор, анализ которого сорвался.');
    const analysed = await upload('разобран.txt', 'Договор, который разобран.');
    const fresh = await upload('свежий.txt', 'Только что загружен, анализ ещё идёт.');
    const legacy = await upload('старый-разбор.txt', 'Файл старого разбора без привязки.');
    const an = await app.inject({ method: 'POST', url: '/api/analysis', headers: auth(u.token), payload: { fileName: 'разобран.txt', fileSize: '1 KB', jurisdiction: 'GB', uploadId: analysed } });
    assert.equal(an.statusCode, 201, an.body);
    // Старый разбор (до привязки upload_id) находит файл по имени — его файл нужен.
    await db.query(
      `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks)
       VALUES ('an_legacy_orphan', $1, NULL, 'старый-разбор.txt', '1 KB', 's', 10, 'Low', 1, '[]')`,
      [u.id],
    );
    await db.query(`UPDATE uploads SET created_at = now() - interval '2 days' WHERE id = ANY($1::text[])`, [[orphan, analysed, legacy]]);
    const key = (id: string) => db.query<{ storage: 's3' | 'local' | 'supabase'; storage_key: string }>('SELECT storage, storage_key FROM uploads WHERE id = $1', [id]);
    const orphanFile = (await key(orphan)).rows[0];

    assert.ok((await purgeOrphanUploads(db)) >= 1);
    const left = (await db.query<{ id: string }>('SELECT id FROM uploads WHERE user_id = $1', [u.id])).rows.map((r) => r.id).sort();
    assert.deepEqual(left, [analysed, fresh, legacy].sort(), 'удалена только сирота');
    await assert.rejects(readFileBytes(orphanFile.storage, orphanFile.storage_key), 'байты сироты удалены из хранилища');
    assert.equal(await purgeOrphanUploads(db), 0, 'повторный запуск ничего не трогает');
  });
});

describe('TRUST_PROXY под fastify 5.12', () => {
  it('true и адреса прокси — как задано; число (больше не поддерживается) — «не доверять», а не молча что-то иное', async () => {
    const { trustProxySetting } = await import('../src/app.ts');
    assert.equal(trustProxySetting(undefined), false);
    assert.equal(trustProxySetting(''), false);
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('true'), true);
    assert.equal(trustProxySetting(' 10.0.0.0/8, 127.0.0.1 '), '10.0.0.0/8, 127.0.0.1');
    assert.equal(trustProxySetting('1'), false);
  });
});
