/**
 * Unit tests for at-rest document encryption (lib/docCrypto.ts).
 * Runs on PGlite (real Postgres in WASM) — the data_keys table and the
 * ON CONFLICT race path are exercised for real, no network needed.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Env BEFORE config import (config reads at load time) — see routes.test.ts.
process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexai-crypto-test-'));
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'unit-test-master-key-A-0123456789abcdef';
process.env.SEED_DEMO_DATA = 'false';

const { config } = await import('../src/config.ts');
const { getDb, migrate } = await import('../src/db.ts');
const {
  encryptionEnabled,
  getOrCreateUserDek,
  clearDekCache,
  encText,
  decText,
  decTextStrict,
  encJsonForJsonb,
  decJsonFromJsonb,
  encFileBuffer,
  decFileBuffer,
  isEncryptedText,
} = await import('../src/lib/docCrypto.ts');

const db = await getDb();
await migrate(db);

const USER = 'u_crypto_test';
const OTHER = 'u_crypto_other';

before(async () => {
  for (const id of [USER, OTHER]) {
    await db.query(
      `INSERT INTO users (id, email, name, initials, firm, jurisdiction, password_hash)
       VALUES ($1, $2, 'Test', 'T', '', '', 'x') ON CONFLICT (id) DO NOTHING`,
      [id, `${id}@test.local`],
    );
  }
});

after(async () => {
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('docCrypto — text round-trip is byte-identical', () => {
  const samples: [string, string][] = [
    ['ascii', 'Simple ASCII contract clause 42.'],
    ['cyrillic', 'Статья 260 ГК РУз: неустойка определяется договором — «пеня» и/или штраф.'],
    ['emoji+zwj', 'Подпись 👩🏽‍⚖️✍️ и эмодзи 🔐; РТЛ: مرحبا; таб\tи\nперенос'],
    ['empty', ''],
    ['dv1-lookalike', 'dv1:not:really:encrypted'],
  ];

  it('encryption is enabled with the test key', () => {
    assert.equal(encryptionEnabled(), true);
  });

  for (const [name, plain] of samples) {
    it(`round-trip === original (${name})`, async () => {
      const stored = await encText(db, USER, plain);
      if (plain !== '') assert.notEqual(stored, plain);
      assert.ok(isEncryptedText(stored));
      assert.equal(await decText(db, USER, stored), plain);
    });
  }

  it('round-trip === original for a 5 MB text', async () => {
    const big = 'Пункт договора №' + 'х'.repeat(5_000_000);
    const stored = await encText(db, USER, big);
    const back = await decText(db, USER, stored);
    assert.equal(back, big); // strict equality = byte-identical UTF-8
  });

  it('legacy plaintext passes through unchanged (lazy migration)', async () => {
    assert.equal(await decText(db, USER, 'обычный незашифрованный текст'), 'обычный незашифрованный текст');
    assert.equal(await decText(db, USER, null), null);
    assert.equal(await decText(db, USER, undefined), null);
  });

  it('tampered / malformed ciphertext → null, never ciphertext', async () => {
    const stored = await encText(db, USER, 'secret clause');
    const tampered = stored.slice(0, -4) + 'AAAA';
    assert.equal(await decText(db, USER, tampered), null);
    assert.equal(await decText(db, USER, 'dv1:garbage'), null);
    assert.equal(await decText(db, USER, 'dv1:a:b'), null);
    await assert.rejects(() => decTextStrict(db, USER, tampered));
  });

  it('a truncated GCM auth tag is rejected (no tag-forgery weakening)', async () => {
    const stored = await encText(db, USER, 'integrity-protected clause');
    const [prefixIv, ivB, tagB, ctB] = [stored.split(':')[0], ...stored.slice('dv1:'.length).split(':')];
    // Truncate the 16-byte tag to 4 bytes — Node would otherwise ACCEPT it.
    const shortTag = Buffer.from(tagB, 'base64url').subarray(0, 4).toString('base64url');
    const forged = `${prefixIv}:${ivB}:${shortTag}:${ctB}`;
    assert.equal(await decText(db, USER, forged), null);
  });

  it("another user's key cannot decrypt (per-user DEK isolation)", async () => {
    const stored = await encText(db, USER, 'only for owner');
    assert.equal(await decText(db, OTHER, stored), null);
  });
});

describe('docCrypto — JSONB document blocks', () => {
  const blocks = [
    { type: 'heading', text: 'Договор аренды', level: 1 },
    { type: 'paragraph', segments: ['Арендодатель ', { text: 'обязан', marks: ['b'] }, { redlineId: 'r1' }] },
  ];

  it('encrypts to a JSON string scalar and decodes back deep-equal', async () => {
    const jsonbParam = await encJsonForJsonb(db, USER, blocks);
    const asStored = JSON.parse(jsonbParam); // what the JSONB column holds
    assert.equal(typeof asStored, 'string');
    assert.ok((asStored as string).startsWith('dv1:'));
    assert.deepEqual(await decJsonFromJsonb(db, USER, asStored), blocks);
  });

  it('legacy shapes: plaintext object and PGlite JSON-string both decode', async () => {
    assert.deepEqual(await decJsonFromJsonb(db, USER, blocks), blocks);
    assert.deepEqual(await decJsonFromJsonb(db, USER, JSON.stringify(blocks)), blocks);
    assert.equal(await decJsonFromJsonb(db, USER, null), null);
  });
});

describe('docCrypto — file buffer envelope', () => {
  it('round-trip is byte-identical (small PDF-like + 10 MB random)', () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(2048)]);
    const big = crypto.randomBytes(10 * 1024 * 1024);
    for (const buf of [pdf, big]) {
      const sealed = encFileBuffer(buf);
      assert.notEqual(Buffer.compare(sealed, buf), 0);
      assert.equal(Buffer.compare(decFileBuffer(sealed), buf), 0);
    }
  });

  it('legacy (non-envelope) buffers pass through unchanged', () => {
    const legacy = Buffer.from('%PDF-1.4 plain old file');
    assert.equal(Buffer.compare(decFileBuffer(legacy), legacy), 0);
    const tiny = Buffer.from('x');
    assert.equal(Buffer.compare(decFileBuffer(tiny), tiny), 0);
  });

  it('corrupted envelope fails loud (never returns garbage)', () => {
    const sealed = encFileBuffer(Buffer.from('important contract bytes'));
    sealed[sealed.length - 1] ^= 0xff;
    assert.throws(() => decFileBuffer(sealed));
  });
});

describe('docCrypto — KEK rotation (current + previous)', () => {
  it('data written under key A decrypts after rotation to key B with PREVIOUS=A', async () => {
    const keyA = config.dataEncryptionKey;
    const keyB = 'unit-test-master-key-B-fedcba9876543210';

    const stored = await encText(db, USER, 'written under key A');
    const sealedFile = encFileBuffer(Buffer.from('file under key A'));

    // Rotate: current → B, previous → A (test-only config mutation).
    (config as { dataEncryptionKey: string }).dataEncryptionKey = keyB;
    (config as { dataEncryptionKeyPrevious: string }).dataEncryptionKeyPrevious = keyA;
    clearDekCache();
    try {
      assert.equal(await decText(db, USER, stored), 'written under key A');
      assert.equal(Buffer.compare(decFileBuffer(sealedFile), Buffer.from('file under key A')), 0);
      // New writes wrap with B and stay readable.
      const fresh = await encText(db, USER, 'written under key B');
      assert.equal(await decText(db, USER, fresh), 'written under key B');
    } finally {
      (config as { dataEncryptionKey: string }).dataEncryptionKey = keyA;
      (config as { dataEncryptionKeyPrevious: string }).dataEncryptionKeyPrevious = '';
      clearDekCache();
    }
  });

  it('encryption DISABLED never mints a data key (no poisoned row)', async () => {
    const keyA = config.dataEncryptionKey;
    const GHOST = 'u_disabled_ghost';
    await db.query(
      `INSERT INTO users (id, email, name, initials, firm, jurisdiction, password_hash)
       VALUES ($1, $2, 'G', 'G', '', '', 'x') ON CONFLICT (id) DO NOTHING`,
      [GHOST, `${GHOST}@test.local`],
    );
    (config as { dataEncryptionKey: string }).dataEncryptionKey = ''; // disabled
    clearDekCache();
    try {
      // A dv1:-shaped value with no key → null, and NO data_keys row is created.
      assert.equal(await decText(db, GHOST, 'dv1:a:b:c'), null);
      assert.equal(await decText(db, GHOST, 'plain legacy text'), 'plain legacy text');
      await assert.rejects(() => getOrCreateUserDek(db, GHOST), /disabled/);
      const rows = await db.query('SELECT 1 FROM data_keys WHERE user_id = $1', [GHOST]);
      assert.equal(rows.rows.length, 0, 'no poisoned data_keys row was written');
    } finally {
      (config as { dataEncryptionKey: string }).dataEncryptionKey = keyA;
      clearDekCache();
    }
  });

  it('wrong master key (no matching previous) → loud error, not silent null', async () => {
    const keyA = config.dataEncryptionKey;
    await encText(db, OTHER, 'seed the DEK row'); // ensure the row exists under A
    (config as { dataEncryptionKey: string }).dataEncryptionKey = 'completely-different-master-key-32chars!!';
    clearDekCache();
    try {
      await assert.rejects(() => getOrCreateUserDek(db, OTHER), /cannot be unwrapped/);
    } finally {
      (config as { dataEncryptionKey: string }).dataEncryptionKey = keyA;
      clearDekCache();
    }
  });
});
