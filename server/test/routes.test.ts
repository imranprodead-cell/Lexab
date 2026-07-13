/**
 * HTTP route tests against an in-memory PGlite database via Fastify `inject()`.
 * No network, no real Anthropic — LLM_FALLBACK=dev makes AI routes return
 * deterministic mock output so the surrounding logic (auth, limits, IDOR) can
 * be exercised end-to-end.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Env must be set BEFORE config is imported (config reads it at load time), so
// everything that touches config is loaded via dynamic import below.
process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexai-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = ''; // an ambient key must not make "no network" tests hit the real API
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';
// Many users register from one loopback IP in this suite — lift the per-minute
// auth cap so the rate limiter (still 10/min in production) doesn't throttle it.
process.env.AUTH_RATE_LIMIT_MAX = '1000';

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

/** A verified user whose plan includes the contract-generator feature. */
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
});

describe('AI usage reservation (atomic limit)', () => {
  it('usage never overshoots the Free cap under a burst of requests', async () => {
    const { token } = await makeUser();
    let ok = 0;
    let rejected = 0; // 402 (over AI limit) or 429 (rate limit) — both are refusals
    // Same fileName every time → reuses the one document, so the doc limit (3)
    // is never hit and we isolate the AI counter.
    for (let i = 0; i < 13; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/analysis',
        headers: auth(token),
        payload: { fileName: 'same.pdf', fileSize: '10 KB', jurisdiction: 'GB' },
      });
      if (res.statusCode === 201) ok++;
      else if (res.statusCode === 402 || res.statusCode === 429) rejected++;
    }
    assert.equal(ok, 10, 'at most 10 succeed');
    assert.equal(rejected, 3, 'the rest are refused');
    const limits = await app.inject({ method: 'GET', url: '/api/billing/limits', headers: auth(token) });
    assert.equal(JSON.parse(limits.body).aiRequests.used, 10, 'usage never overshoots the cap');
  });

  it('reserveAiRequest is atomic: 12 concurrent reserves for a Free user grant exactly 10', async () => {
    const { reserveAiRequest } = await import('../src/lib/limits.ts');
    const { id } = await makeUser();
    // Fire concurrently — the check-then-increment must not let more than 10 through.
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => reserveAiRequest(db, id).then(() => 'ok').catch(() => 'denied')),
    );
    assert.equal(outcomes.filter((o) => o === 'ok').length, 10);
    assert.equal(outcomes.filter((o) => o === 'denied').length, 2);
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

describe('changing email requires re-verification', () => {
  it('flips email_verified to false and blocks a taken address', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const newEmail = `moved_${Date.now()}_${counter++}@test.local`;
    const res = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(u.token), payload: { email: newEmail } });
    assert.equal(res.statusCode, 200, res.body);
    const row = await db.query<{ email: string; email_verified: boolean }>(
      'SELECT email, email_verified FROM users WHERE id = $1',
      [u.id],
    );
    assert.equal(row.rows[0].email, newEmail);
    assert.equal(row.rows[0].email_verified, false, 'a new address must be unverified');
    const clash = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(u.token), payload: { email: other.email } });
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

describe('saved templates (personal library)', () => {
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

  it('rejects an empty title', async () => {
    const { token } = await makeUser();
    const res = await app.inject({ method: 'POST', url: '/api/templates/saved', headers: auth(token), payload: { title: '', content: 'x' } });
    assert.equal(res.statusCode, 400);
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
  });

  it('is gated to plans that include the contract generator (Free → 402)', async () => {
    const { token } = await makeUser(); // Free plan
    const res = await app.inject({ method: 'POST', url: '/api/analysis/draft', headers: auth(token), payload: { prompt: 'A short NDA' } });
    assert.equal(res.statusCode, 402, 'Free plan must be told to upgrade');
  });
});
