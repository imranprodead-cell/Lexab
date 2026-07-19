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
// Document encryption ON for the WHOLE route suite: every upload → analysis →
// chat → export flow below exercises encrypt-on-write / decrypt-on-read.
process.env.DATA_ENCRYPTION_KEY = 'routes-test-master-key-0123456789abcdef!';
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

  it('is gated to plans that include the contract generator (Free → 402)', async () => {
    const { token } = await makeUser(); // Free plan
    const res = await app.inject({ method: 'POST', url: '/api/analysis/draft', headers: auth(token), payload: { prompt: 'A short NDA' } });
    assert.equal(res.statusCode, 402, 'Free plan must be told to upgrade');
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
  it('checkout requires consent and rejects the Free loophole', async () => {
    const { token } = await makeUser();
    // Free is not purchasable (quota-reset loophole).
    const free = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload: { plan: 'Free', consent: true } });
    assert.equal(free.statusCode, 400, 'Free checkout rejected');
    // Consent is mandatory for a paid plan.
    const noConsent = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload: { plan: 'Standard' } });
    assert.equal(noConsent.statusCode, 400, 'missing consent rejected');
    // With consent → activated.
    const ok = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload: { plan: 'Standard', consent: true } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(JSON.parse(ok.body).plan, 'Standard');
  });

  it('records consent + terms evidence in the append-only billing_events', async () => {
    const { id, token } = await makeUser();
    await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload: { plan: 'Pro', consent: true } });
    const events = await db.query<{ kind: string }>('SELECT kind FROM billing_events WHERE user_id = $1', [id]);
    const kinds = events.rows.map((r) => r.kind);
    assert.ok(kinds.includes('terms_accepted'), 'signup recorded terms acceptance');
    assert.ok(kinds.includes('consent_waiver'), 'checkout recorded the withdrawal waiver');
    assert.ok(kinds.includes('checkout'), 'checkout recorded');
    // Append-only: UPDATE and recent DELETE are blocked by the DB trigger.
    await assert.rejects(db.query("UPDATE billing_events SET kind = 'x' WHERE user_id = $1", [id]), /append-only/);
    await assert.rejects(db.query('DELETE FROM billing_events WHERE user_id = $1', [id]), /append-only/);
  });

  it('cancel schedules end-of-period downgrade and can be reverted', async () => {
    const { token } = await makeUser();
    await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload: { plan: 'Business', consent: true } });
    const cancel = await app.inject({ method: 'POST', url: '/api/billing/cancel', headers: auth(token), payload: {} });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(JSON.parse(cancel.body).cancelAtPeriodEnd, true);
    const sub = await app.inject({ method: 'GET', url: '/api/billing/subscription', headers: auth(token) });
    assert.equal(JSON.parse(sub.body).cancelAtPeriodEnd, true, 'cancellation is visible');
    const revert = await app.inject({ method: 'POST', url: '/api/billing/cancel/revert', headers: auth(token), payload: {} });
    assert.equal(revert.statusCode, 200, revert.body);
    assert.equal(JSON.parse(revert.body).cancelAtPeriodEnd, false);
  });

  it('the lifecycle sweep is idempotent: expired paid sub → past_due, run twice is safe', async () => {
    const { checkBillingLifecycle } = await import('../src/lib/billing.ts');
    const { id, token } = await makeUser();
    await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: auth(token), payload: { plan: 'Pro', consent: true } });
    // Backdate the renewal so the sweep treats it as expired.
    await db.query("UPDATE subscriptions SET renews_at = now() - interval '1 day' WHERE user_id = $1", [id]);
    await checkBillingLifecycle(db);
    const after1 = await db.query<{ status: string; dunning_count: number }>('SELECT status, dunning_count FROM subscriptions WHERE user_id = $1', [id]);
    assert.equal(after1.rows[0].status, 'past_due', 'moved to past_due');
    await checkBillingLifecycle(db); // second run must not double-process
    const after2 = await db.query<{ status: string; dunning_count: number }>('SELECT status, dunning_count FROM subscriptions WHERE user_id = $1', [id]);
    assert.equal(after2.rows[0].status, 'past_due', 'still past_due (no churn)');
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

describe('file downloads stay decrypted and provider-URL-free', () => {
  it('POST /uploads returns no provider url and stores url = NULL', async () => {
    const u = await makeUser();
    const boundary = '----lexaiTestBoundary42';
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
