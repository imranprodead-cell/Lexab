/**
 * Encryption integration proofs (PGlite + Fastify inject, no network):
 *  1. PROMPT EQUALITY — the exact context string the LLM receives is strictly
 *     `===` whether the rows are stored encrypted or legacy plaintext. This is
 *     the guarantee that enabling encryption cannot change AI answers.
 *  2. Ciphertext-leak sweep — no API response ever contains "dv1:".
 *  3. Rows in the DB really ARE encrypted (dv1:/envelope present).
 *  4. Content search still finds documents by phrases inside encrypted text.
 *  5. DELETE /me crypto-shreds the user's data key (cascade).
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexai-enc-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'encryption-test-master-key-0123456789abc';
process.env.SEED_DEMO_DATA = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');
const { buildAnalysisContext } = await import('../src/routes/chats.routes.ts');
const { encText, encJsonForJsonb, isEncryptedText } = await import('../src/lib/docCrypto.ts');

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
  const email = `enc${Date.now()}_${counter++}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'E', email, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  const { id, verify_token } = row.rows[0];
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
  return { email, id, token: JSON.parse(login.body).token };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Identical document content seeded for two users — one legacy plaintext, one
 *  encrypted. The LLM context strings built from both must match byte-for-byte. */
const FILE_NAME = 'Договор_аренды.txt';
const SUMMARY = 'Аренда квартиры: риск в пункте о депозите (ст. 577 ГК РУз).';
const BLOCKS = [
  { type: 'heading', text: 'Договор аренды' },
  { type: 'paragraph', segments: ['Арендатор вносит депозит ', { redlineId: 'r1' }, ' до подписания.'] },
  { type: 'paragraph', segments: [{ text: 'Срок аренды — 12 месяцев.', marks: ['b'] }] },
];
const EXTRACTED = 'Полный текст договора аренды квартиры. Депозит равен двум месячным платежам. Кириллица ёЁ, эмодзи 🔐.';

async function seedAnalysis(userId: string, encrypted: boolean): Promise<string> {
  const analysisId = `an_${encrypted ? 'enc' : 'plain'}_${userId.slice(-6)}`;
  const docId = `d_${encrypted ? 'enc' : 'plain'}_${userId.slice(-6)}`;
  const summary = encrypted ? await encText(db, userId, SUMMARY) : SUMMARY;
  const blocks = encrypted ? await encJsonForJsonb(db, userId, BLOCKS) : JSON.stringify(BLOCKS);
  const del = encrypted ? await encText(db, userId, 'два месячных платежа') : 'два месячных платежа';
  const ins = encrypted ? await encText(db, userId, 'один месячный платёж') : 'один месячный платёж';
  const text = encrypted ? await encText(db, userId, EXTRACTED) : EXTRACTED;
  await db.query(
    `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes)
     VALUES ($1, $2, $3, '—', 'In review', 'Low', 'UZ', 100)`,
    [docId, userId, FILE_NAME],
  );
  await db.query(
    `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks)
     VALUES ($1, $2, $3, $4, '1 KB', $5, 40, 'Low', 3, $6)`,
    [analysisId, userId, docId, FILE_NAME, summary, blocks],
  );
  await db.query(
    `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status)
     VALUES ($1, 'r1', 0, $2, $3, 'Medium', 'accepted')`,
    [analysisId, del, ins],
  );
  await db.query(
    `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
     VALUES ($1, $2, $3, 100, 'text/plain', 'local', $4, '/x', $5)`,
    [`up_${analysisId}`, userId, FILE_NAME, `${analysisId}.txt`, text],
  );
  return analysisId;
}

describe('encryption — the LLM sees byte-identical input', () => {
  it('buildAnalysisContext(encrypted rows) === buildAnalysisContext(plaintext rows)', async () => {
    const plainUser = await makeUser();
    const encUser = await makeUser();
    const plainId = await seedAnalysis(plainUser.id, false);
    const encId = await seedAnalysis(encUser.id, true);

    const fromPlain = await buildAnalysisContext(db, plainUser.id, plainId);
    const fromEnc = await buildAnalysisContext(db, encUser.id, encId);
    assert.ok(fromPlain && fromPlain.length > 100, 'context was actually built');
    assert.equal(fromEnc, fromPlain); // strict === — byte-identical model input
    assert.ok(fromPlain.includes(EXTRACTED), 'full source text present');
    assert.ok(fromPlain.includes('один месячный платёж'), 'accepted redline applied');
    assert.ok(!fromEnc.includes('dv1:'), 'no ciphertext reaches the model');
  });
});

describe('encryption — API responses never leak ciphertext; DB rows really are encrypted', () => {
  it('upload → analyze → read → chat-context: responses clean, storage encrypted', async () => {
    const u = await makeUser();
    // JSON-mode analysis over a seeded upload (dev-fallback model).
    const encId = await seedAnalysis(u.id, true);

    const analysis = await app.inject({ method: 'GET', url: `/api/analysis/${encId}`, headers: auth(u.token) });
    assert.equal(analysis.statusCode, 200, analysis.body);
    assert.ok(!analysis.body.includes('dv1:'), 'GET /analysis leaks no ciphertext');
    const parsed = JSON.parse(analysis.body);
    assert.equal(parsed.summary, SUMMARY, 'summary decrypts to the original');
    assert.equal(parsed.redlines[0].insText, 'один месячный платёж');

    // The stored rows ARE ciphertext.
    const rawA = await db.query<{ summary: string; document_blocks: unknown }>(
      'SELECT summary, document_blocks FROM analyses WHERE id = $1',
      [encId],
    );
    assert.ok(isEncryptedText(rawA.rows[0].summary), 'summary column holds dv1: ciphertext');
    // The JSONB scalar comes back either unwrapped ("dv1:…") or as the JSON
    // literal ("\"dv1:…\"") depending on the adapter — both are ciphertext.
    const rawBlocks = rawA.rows[0].document_blocks;
    const blocksStr =
      typeof rawBlocks === 'string' && rawBlocks.startsWith('"') ? (JSON.parse(rawBlocks) as string) : (rawBlocks as string);
    assert.ok(typeof blocksStr === 'string' && blocksStr.startsWith('dv1:'), 'blocks column holds ciphertext scalar');

    // A live analysis via the API (dev fallback) also stores ciphertext.
    const created = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: FILE_NAME, fileSize: '1 KB', jurisdiction: 'UZ' },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.ok(!created.body.includes('dv1:'));
    const createdId = (JSON.parse(created.body) as { id: string }).id;
    const rawCreated = await db.query<{ summary: string }>('SELECT summary FROM analyses WHERE id = $1', [createdId]);
    assert.ok(isEncryptedText(rawCreated.rows[0].summary), 'API-created analysis is encrypted at rest');
  });

  it('chat messages are stored encrypted and served decrypted', async () => {
    const u = await makeUser();
    const chat = await app.inject({ method: 'POST', url: '/api/chats', headers: auth(u.token), payload: { title: 'enc chat' } });
    const chatId = (JSON.parse(chat.body) as { id: string }).id;
    const sent = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: auth(u.token),
      payload: { text: 'Проверь пункт о неустойке — ст. 260 ГК' },
    });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.ok(!sent.body.includes('dv1:'));

    const raw = await db.query<{ text: string | null }>(
      `SELECT text FROM chat_messages WHERE session_id = $1 AND text IS NOT NULL`,
      [chatId],
    );
    assert.ok(raw.rows.length >= 2, 'user + assistant turns stored');
    for (const r of raw.rows) assert.ok(isEncryptedText(r.text as string), 'every stored turn is ciphertext');

    const list = await app.inject({ method: 'GET', url: `/api/chats/${chatId}/messages`, headers: auth(u.token) });
    assert.equal(list.statusCode, 200);
    assert.ok(!list.body.includes('dv1:'));
    assert.ok(list.body.includes('неустойке'), 'messages decrypt for the wire');
  });

  it('chat session TITLE is encrypted at rest and decrypted on read', async () => {
    const u = await makeUser();
    const title = 'NDA с Acme: неустойка 500 000 USD за разглашение';
    const chat = await app.inject({ method: 'POST', url: '/api/chats', headers: auth(u.token), payload: { title } });
    assert.equal(chat.statusCode, 201, chat.body);
    assert.ok(!chat.body.includes('dv1:'));
    assert.ok(chat.body.includes('Acme'), 'POST /chats returns the plaintext title');
    // Ciphertext at rest — a DB dump of chat_sessions must not reveal the words.
    const raw = await db.query<{ title: string }>('SELECT title FROM chat_sessions WHERE user_id = $1', [u.id]);
    assert.ok(isEncryptedText(raw.rows[0].title), 'title column holds dv1: ciphertext');
    assert.ok(!raw.rows[0].title.includes('Acme'));
    // GET /chats decrypts it back.
    const listed = await app.inject({ method: 'GET', url: '/api/chats', headers: auth(u.token) });
    assert.ok(listed.body.includes('неустойка'), 'GET /chats decrypts the title');
  });

  it('saved templates: encrypted at rest, decrypted on read', async () => {
    const u = await makeUser();
    const saved = await app.inject({
      method: 'POST',
      url: '/api/templates/saved',
      headers: auth(u.token),
      payload: { title: 'Аренда', content: 'ДОГОВОР АРЕНДЫ\n1. Стороны…' },
    });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.ok(!saved.body.includes('dv1:'));
    const raw = await db.query<{ content: string }>('SELECT content FROM saved_templates WHERE user_id = $1', [u.id]);
    assert.ok(isEncryptedText(raw.rows[0].content));
    const list = await app.inject({ method: 'GET', url: '/api/templates/saved', headers: auth(u.token) });
    assert.ok(list.body.includes('ДОГОВОР АРЕНДЫ'));
    assert.ok(!list.body.includes('dv1:'));
  });
});

describe('encryption — content search over encrypted documents', () => {
  it('finds a document by a phrase that lives only inside encrypted text', async () => {
    const u = await makeUser();
    await seedAnalysis(u.id, true);
    // "депозит" appears in the encrypted extracted_text/summary, NOT in the name.
    const res = await app.inject({ method: 'GET', url: '/api/documents?search=депозит', headers: auth(u.token) });
    assert.equal(res.statusCode, 200, res.body);
    const docs = JSON.parse(res.body) as { name: string }[];
    assert.ok(docs.some((d) => d.name === FILE_NAME), 'content search matched the encrypted document');
    // A phrase that exists nowhere must NOT match.
    const miss = await app.inject({ method: 'GET', url: '/api/documents?search=небоскрёб', headers: auth(u.token) });
    assert.equal((JSON.parse(miss.body) as unknown[]).length, 0);
  });
});

describe('encryption — account deletion crypto-shreds the data key', () => {
  it('DELETE /me removes the data_keys row (cascade)', async () => {
    const u = await makeUser();
    await seedAnalysis(u.id, true); // forces DEK creation
    const before = await db.query('SELECT 1 FROM data_keys WHERE user_id = $1', [u.id]);
    assert.equal(before.rows.length, 1, 'DEK row exists');
    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: auth(u.token), payload: { confirm: u.email } });
    assert.equal(del.statusCode, 204, del.body);
    const afterRows = await db.query('SELECT 1 FROM data_keys WHERE user_id = $1', [u.id]);
    assert.equal(afterRows.rows.length, 0, 'DEK row is gone — remaining backups are unreadable');
  });
});
