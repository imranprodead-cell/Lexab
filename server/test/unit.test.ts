/** Unit tests for pure server modules: `npm test` (runs on plain node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackAnalysis, fallbackChatReply, fallbackCompare, fallbackTemplateDraft } from '../src/fallback.ts';
import { ALLOWED_EXTENSIONS, fileExtension } from '../src/extract.ts';
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
