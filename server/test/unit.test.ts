/** Unit tests for pure server modules: `npm test` (runs on plain node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackAnalysis, fallbackChatReply, fallbackCompare, fallbackTemplateDraft } from '../src/fallback.ts';
import { ALLOWED_EXTENSIONS, fileExtension, verifyFileSignature } from '../src/extract.ts';
import { formatSize, relativeTimeRu } from '../src/lib/format.ts';
import { newId } from '../src/lib/ids.ts';
import { hashPassword, verifyPassword } from '../src/lib/passwords.ts';
import { buildSimplePdf } from '../src/lib/pdf.ts';
import { asObject, requireEmail, requireOneOf, requireString } from '../src/lib/validate.ts';

test('passwords: hash → verify roundtrip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt:'));
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.equal(await verifyPassword('anything', 'garbage'), false);
});

test('formatSize matches the UI display style', () => {
  assert.equal(formatSize(500), '500 B');
  assert.equal(formatSize(48 * 1024), '48 KB');
  assert.equal(formatSize(2.5 * 1024 * 1024), '2.5 MB');
});

test('relativeTimeRu buckets', () => {
  const now = new Date('2026-07-08T12:00:00Z');
  assert.equal(relativeTimeRu(new Date('2026-07-08T11:59:40Z'), now), 'Только что');
  assert.equal(relativeTimeRu(new Date('2026-07-08T11:30:00Z'), now), '30 мин назад');
  assert.equal(relativeTimeRu(new Date('2026-07-08T07:00:00Z'), now), '5 ч назад');
  assert.equal(relativeTimeRu(new Date('2026-07-07T06:00:00Z'), now), 'Вчера');
});

test('ids carry the prefix and are unique', () => {
  const a = newId('d');
  const b = newId('d');
  assert.ok(a.startsWith('d_'));
  assert.notEqual(a, b);
});

test('validate: happy paths and rejections', () => {
  const body = asObject({ email: 'User@Firm.com', role: 'admin', name: 'A' });
  assert.equal(requireEmail(body), 'user@firm.com');
  assert.equal(requireOneOf(body, 'role', ['admin', 'viewer'] as const), 'admin');
  assert.equal(requireString(body, 'name'), 'A');
  assert.throws(() => asObject('nope'), /Malformed/);
  assert.throws(() => requireEmail(asObject({ email: 'not-an-email' })), /Invalid email/);
  assert.throws(() => requireString(asObject({}), 'missing'), /required/);
});

test('extract: extension gate', () => {
  assert.equal(fileExtension('Contract.V2.DOCX'), '.docx');
  assert.ok(ALLOWED_EXTENSIONS.includes('.pdf'));
  assert.ok(!ALLOWED_EXTENSIONS.includes('.exe'));
});

test('pdf builder emits a valid single-file PDF', () => {
  const pdf = buildSimplePdf('Test report', [{ heading: 'Section' }, { text: 'Hello world '.repeat(120) }]);
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('%%EOF'));
  assert.ok(s.includes('/Type /Page'));
});

test('fallbacks stay well-formed (used when no LLM key is set)', () => {
  const analysis = fallbackAnalysis('NDA_v2.docx');
  assert.ok(analysis.riskScore >= 0 && analysis.riskScore <= 100);
  assert.equal(analysis.redlines.length, 3);
  // every redline referenced from the document exists
  const ids = new Set(analysis.redlines.map((r) => r.id));
  for (const block of analysis.document) {
    for (const seg of block.segments ?? []) {
      if (typeof seg !== 'string') assert.ok(ids.has(seg.redlineId));
    }
  }
  assert.ok(fallbackChatReply('/draft').length > 0);
  assert.ok(fallbackCompare().changes.length > 0);
  assert.ok(fallbackTemplateDraft('NDA', { partyA: 'A', partyB: 'B', jurisdiction: '', term: '', details: '' }).includes('NDA'));
});

test('storage: local deleteFile is idempotent and stays inside uploads/', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lexai-storage-'));
  // Set DATA_DIR BEFORE the first import of storage.ts — config.ts reads the
  // env once at import time (no other test module pulls config in).
  process.env.DATA_DIR = dir;
  const { saveFile, readFileBytes, deleteFile } = await import('../src/storage.ts');
  try {
    const stored = await saveFile(Buffer.from('hello'), 'note.txt', 'text/plain');
    assert.equal(stored.storage, 'local');
    assert.equal((await readFileBytes('local', stored.key)).toString(), 'hello');

    await deleteFile('local', stored.key);
    await assert.rejects(readFileBytes('local', stored.key));
    // Deleting again is a no-op, not an error.
    await deleteFile('local', stored.key);

    // A traversal key must not reach outside DATA_DIR/uploads.
    const outside = path.join(dir, 'outside.txt');
    await fs.writeFile(outside, 'keep me');
    await deleteFile('local', '../outside.txt');
    assert.equal((await fs.readFile(outside)).toString(), 'keep me');
    await deleteFile('local', '../../etc/passwd'); // resolves to uploads/passwd → ENOENT → ignored
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('verifyFileSignature: real files pass, spoofed/renamed files fail', () => {
  // Real magic bytes.
  assert.equal(verifyFileSignature(Buffer.from('%PDF-1.7\n...'), 'a.pdf'), true);
  assert.equal(verifyFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]), 'a.docx'), true);
  assert.equal(verifyFileSignature(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'a.doc'), true);
  assert.equal(verifyFileSignature(Buffer.from('just plain text'), 'a.txt'), true);
  // UTF-16 text (BOM + NUL bytes) is valid, not a binary payload.
  assert.equal(verifyFileSignature(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]), 'utf16.txt'), true);
  // A PDF with a leading UTF-8 BOM still passes (readers scan for %PDF).
  assert.equal(verifyFileSignature(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('%PDF-1.5')]), 'bom.pdf'), true);
  // Spoofed: an executable renamed to .pdf, and a binary renamed to .txt.
  assert.equal(verifyFileSignature(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'evil.pdf'), false);
  assert.equal(verifyFileSignature(Buffer.from([0x68, 0x69, 0x00, 0x00]), 'evil.txt'), false); // NUL → binary
  // Empty file is never valid.
  assert.equal(verifyFileSignature(Buffer.alloc(0), 'a.pdf'), false);
});
