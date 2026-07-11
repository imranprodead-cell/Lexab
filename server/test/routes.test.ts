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
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

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
