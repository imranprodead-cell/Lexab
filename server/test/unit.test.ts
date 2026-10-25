/** Unit tests for pure server modules: `npm test` (runs on plain node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackAnalysis, fallbackChatReply, fallbackCompare } from '../src/fallback.ts';
import { extractJsonObject, isDeepSeekModel } from '../src/llm.ts';
import { MODELS, noThinking, serverFallback } from '../src/models.ts';
import zlib from 'node:zlib';
import { ALLOWED_EXTENSIONS, extractText, fileExtension, usablePdfText, verifyFileSignature, zipRealDecompressedSize } from '../src/extract.ts';
import { formatSize, relativeTimeRu } from '../src/lib/format.ts';
import { newId } from '../src/lib/ids.ts';
import { hashPassword, verifyPassword } from '../src/lib/passwords.ts';
import { buildSimplePdf } from '../src/lib/pdf.ts';
import { buildDocxParagraphs, DOCX_NUMBERING } from '../src/lib/docxExport.ts';
import { Document, Packer } from 'docx';
import { asObject, requireEmail, requireOneOf, requireString } from '../src/lib/validate.ts';

test('passwords: hash → verify roundtrip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt:'));
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.equal(await verifyPassword('anything', 'garbage'), false);
});

test('zipRealDecompressedSize: real inflation catches a bomb that lies about its size', () => {
  // Build a valid single-entry ZIP (deflate) around arbitrary raw content.
  const makeZip = (name: string, raw: Buffer): Buffer => {
    const comp = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'latin1');
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // method = deflate
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length >>> 0, 22); // declared uncompressed (deliberately not trusted)
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const localAndData = Buffer.concat([local, comp]);
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length >>> 0, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 42); // local header offset
    nameBuf.copy(cd, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(localAndData.length, 16); // central directory offset
    return Buffer.concat([localAndData, cd, eocd]);
  };

  // Honest small entry → its REAL decompressed size is returned.
  assert.equal(zipRealDecompressedSize(makeZip('a.txt', Buffer.from('hello world'.repeat(10)))), 110);
  // A bomb: 130 MB of zeros compresses to a few KB but inflates past the 120 MB
  // cap — declared-size guards miss this; real inflation flags it as Infinity.
  assert.equal(
    zipRealDecompressedSize(makeZip('word/document.xml', Buffer.alloc(130 * 1024 * 1024))),
    Infinity,
    'a decompression bomb must be caught by real inflation, not declared metadata',
  );
  // Not a ZIP → null (caller falls back to the raw 10 MB byte cap).
  assert.equal(zipRealDecompressedSize(Buffer.from('%PDF-1.4 not a zip')), null);
});

test('extractText: a real .docx passes the bomb guard and yields its text', async () => {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('Confidential Agreement clause one.')] })] }],
  });
  const buf = await Packer.toBuffer(doc);
  const size = zipRealDecompressedSize(buf);
  // A legitimate docx must NOT be flagged as a bomb (no false positive).
  assert.ok(size === null || (typeof size === 'number' && size < 120 * 1024 * 1024), 'real docx not flagged as a bomb');
  const text = await extractText(buf, 'agreement.docx');
  assert.ok(text && text.includes('Confidential Agreement'), 'text extracted from a real docx');
});

/** PDF «скан»: страницы без текстового слоя (только графика), по желанию — со
 *  штампом сканера внизу каждой страницы, как у бесплатного CamScanner. */
async function scanLikePdf(pages: number, stamp?: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 40, y: 40, width: 515, height: 760, borderWidth: 2 });
    if (stamp) page.drawText(stamp, { x: 420, y: 12, size: 8, font });
  }
  return Buffer.from(await doc.save());
}

test('extractText: скан из 2+ страниц — это скан, а не «текст» из пометок страниц', async () => {
  // pdf-parse 2.x ставит между страницами «-- 1 of 2 --»: раньше одни эти
  // пометки проходили порог, и многостраничный скан считался текстовым.
  for (const pages of [1, 2, 5]) {
    assert.equal(await extractText(await scanLikePdf(pages), `scan-${pages}.pdf`), null, `${pages} стр.`);
  }
  // Штамп сканера на каждой странице — тоже не текст договора.
  assert.equal(await extractText(await scanLikePdf(3, 'Scanned with CamScanner'), 'cam.pdf'), null);
});

test('extractText: текстовый PDF читается целиком и без служебных пометок страниц', async () => {
  const pdf = await buildSimplePdf('Договор поставки', [
    { heading: '1. Предмет договора' },
    { text: 'Поставщик обязуется поставить оборудование до 31 декабря, неустойка 0,5% в день.' },
  ]);
  const text = await extractText(pdf, 'contract.pdf');
  assert.ok(text?.includes('неустойка 0,5% в день'), String(text));
  assert.ok(!/-- \d+ of \d+ --/.test(text ?? ''), 'пометок страниц в тексте нет');
});

test('usablePdfText: текст, сохранённый до исправления, чистится так же', () => {
  // Старый многостраничный скан: в базе одни пометки → это скан.
  assert.equal(usablePdfText('-- 1 of 2 --\n\n\n\n-- 2 of 2 --'), null);
  assert.equal(usablePdfText('Scanned with CamScanner\n\n-- 1 of 3 --\n\nScanned with CamScanner\n\n-- 2 of 3 --\n\n-- 3 of 3 --'), null);
  // Настоящий текст остаётся, пометки уходят.
  const clause = '1.1. Поставщик обязуется поставить Покупателю цемент марки М400 в срок до 31 декабря.';
  assert.equal(usablePdfText(`${clause}\n\n-- 1 of 1 --`), clause);
  assert.equal(usablePdfText(null), null);
});

test('extractText: TXT в старой кодировке Windows читается, а не превращается в «�����»', async () => {
  // Windows-1251 — Блокнот, 1С, «Сохранить как текст» в старом Word.
  const cp1251 = (s: string) =>
    Buffer.from(
      [...s].map((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        if (c < 0x80) return c;
        if (c >= 0x410 && c <= 0x44f) return c - 0x350; // А…я → 0xC0…0xFF
        return ({ Ё: 0xa8, ё: 0xb8, '№': 0xb9, '—': 0x97 } as Record<string, number>)[ch] ?? 0x3f;
      }),
    );
  const ru = 'ДОГОВОР ПОСТАВКИ № 17\n3.1. Неустойка 0,5% за каждый день просрочки. Ёмкость склада — 120 т.';
  assert.equal(await extractText(cp1251(ru), 'dogovor.txt'), ru);
  // Windows-1252 (западноевропейский) — не превращается в «cafй».
  const fr = 'Contrat de vente: Société Müller & Café, prix 5 000.';
  assert.equal(await extractText(Buffer.from(fr, 'latin1'), 'contrat.txt'), fr);
  // UTF-8 и UTF-8 с BOM — как были.
  assert.equal(await extractText(Buffer.from(ru, 'utf8'), 'utf8.txt'), ru);
  assert.equal(await extractText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ru, 'utf8')]), 'bom.md'), ru);
});

test('reflowPdfText: строки страницы PDF склеиваются в абзацы, пункты и таблицы — отдельно', async () => {
  const { reflowPdfText } = await import('../src/lib/fullText.ts');
  const lines = [
    'ДОГОВОР ПОСТАВКИ № 17',
    '1.1. Поставщик обязуется поставить Покупателю цемент марки М400 в количестве и в',
    'сроки, согласованные сторонами в спецификациях, являющихся неотъемлемой частью',
    'настоящего договора, а Покупатель обязуется принять и оплатить товар.',
    '1.2. Цена договора составляет 150 000 000 (сто пятьдесят миллионов) сум, включая НДС,',
    '150 000 000 сум уплачиваются частями, расходы на доставку несёт Поставщик по договору.',
    'Наименование Кол-во Цена',
    'Цемент М400 100 т 1 500 000 сум',
  ];
  assert.deepEqual(reflowPdfText(lines.join('\n')).split('\n\n'), [
    'ДОГОВОР ПОСТАВКИ № 17',
    '1.1. Поставщик обязуется поставить Покупателю цемент марки М400 в количестве и в сроки, согласованные сторонами в спецификациях, являющихся неотъемлемой частью настоящего договора, а Покупатель обязуется принять и оплатить товар.',
    // Строка-продолжение с числа — не новый пункт.
    '1.2. Цена договора составляет 150 000 000 (сто пятьдесят миллионов) сум, включая НДС, 150 000 000 сум уплачиваются частями, расходы на доставку несёт Поставщик по договору.',
    'Наименование Кол-во Цена',
    'Цемент М400 100 т 1 500 000 сум',
  ]);
});

test('applyManualEdits: правка пункта переносится в полный текст; ненайденная — в список; сопоставление при другом числе пунктов', async () => {
  const { applyManualEdits, applyAcceptedRedlines } = await import('../src/lib/fullText.ts');
  const source = 'Пункт 1. Стороны.\n\nПункт 2. Неустойка 0,5% в день.\n\nПункт 3. Срок — 1 год.';
  const del = new Map([['r1', '0,5%']]);
  const original = ['Пункт 2. Неустойка 0,5% в день.', 'Пункт 9. Чего нет в тексте.'];
  const blocks = [
    { type: 'paragraph' as const, segments: ['Пункт 2. Неустойка ', { redlineId: 'r1' }, ' в день, но не более 10%.'] },
    { type: 'paragraph' as const, segments: ['Пункт 9. Чего нет в тексте, дополнено.'] },
  ];
  const edited = applyManualEdits(source, original, blocks, del);
  assert.equal(edited.text, 'Пункт 1. Стороны.\n\nПункт 2. Неустойка 0,5% в день, но не более 10%.\n\nПункт 3. Срок — 1 год.');
  assert.deepEqual(edited.unplaced, [{ was: 'Пункт 9. Чего нет в тексте.', now: 'Пункт 9. Чего нет в тексте, дополнено.' }]);
  // Затем принятая правка ИИ — уже поверх ручной.
  const merged = applyAcceptedRedlines(edited.text, [{ delText: '0,5%', insText: '0,1%', status: 'accepted' as const }]);
  assert.ok(merged.text.includes('Неустойка 0,1% в день, но не более 10%.'));
  // Без ручных правок текст не трогается.
  assert.equal(applyManualEdits(source, null, blocks, del).text, source);
  // Другое число пунктов: неизменные сопоставляются по тексту, правка — по месту.
  const lcs = applyManualEdits(source, ['Пункт 1. Стороны.', 'Пункт 3. Срок — 1 год.'], [
    { type: 'paragraph' as const, segments: ['Пункт 1. Стороны.'] },
    { type: 'heading' as const, text: 'Новый заголовок' },
    { type: 'paragraph' as const, segments: ['Пункт 3. Срок — 2 года.'] },
  ], del);
  assert.ok(lcs.text.includes('Пункт 3. Срок — 2 года.'), lcs.text);
  assert.ok(lcs.text.includes('Пункт 1. Стороны.'));
});

test('applyAcceptedRedlines: пробелы нестрого, все вхождения, «$&» буквально — и линейное время на враждебном тексте', async () => {
  const { applyAcceptedRedlines } = await import('../src/lib/fullText.ts');
  const acc = (delText: string, insText: string) => ({ delText, insText, status: 'accepted' as const });
  // Перенос строки, двойной пробел и NBSP внутри формулировки — та же формулировка.
  assert.equal(
    applyAcceptedRedlines('Неустойка 0,5%\nза  каждый\u00a0день. И снова: неустойка 0,5% за каждый день.', [acc('0,5% за каждый день', '0,1% за каждый день')]).text,
    'Неустойка 0,1% за каждый день. И снова: неустойка 0,1% за каждый день.',
  );
  // Ведущий пробел в формулировке требует пробела перед ней (как прежнее \s+).
  assert.equal(applyAcceptedRedlines('ограничена суммой договора.', [acc(' суммой договора', ' двойной суммой договора')]).text, 'ограничена двойной суммой договора.');
  // Спецсимволы замены вставляются буквально.
  assert.equal(applyAcceptedRedlines('Цена X.', [acc('X', '$& и $$')]).text, 'Цена $& и $$.');
  // Не найдено — в списке «не встали».
  assert.equal(applyAcceptedRedlines('Текст.', [acc('нет такого', 'y')]).unapplied.length, 1);
  // Враждебный текст: «a a a …» и формулировка «a a … a b». Прежнее регулярное
  // выражение перебирало бы это минутами; теперь — один проход.
  const started = Date.now();
  const res = applyAcceptedRedlines('a '.repeat(1_000_000), [acc(`${'a '.repeat(3000)}b`, 'c')]);
  assert.equal(res.unapplied.length, 1);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} мс`);
});

test('applyManualEdits: замены — по исходному тексту разом (новая редакция одного пункта не «ловит» другой)', async () => {
  const { applyManualEdits } = await import('../src/lib/fullText.ts');
  const source = 'Пункт А. Срок 10 дней.\n\nПункт Б. Оплата.';
  const res = applyManualEdits(
    source,
    ['Пункт А. Срок 10 дней.', 'Пункт Б. Оплата.'],
    [
      // Новая редакция А содержит СТАРЫЙ текст Б — он не должен стать местом правки Б.
      { type: 'paragraph' as const, segments: ['Пункт А. Срок 10 дней. Пункт Б. Оплата.'] },
      { type: 'paragraph' as const, segments: ['Пункт Б. Оплата в течение 5 дней.'] },
    ],
    new Map(),
  );
  assert.equal(res.text, 'Пункт А. Срок 10 дней. Пункт Б. Оплата.\n\nПункт Б. Оплата в течение 5 дней.');
  assert.deepEqual(res.unplaced, []);
});

test('reflowPdfText: перенос со знаком «-» не превращается в «слово- продолжение»', async () => {
  const { reflowPdfText } = await import('../src/lib/fullText.ts');
  const lines = [
    'Поставщик обязуется поставить товар на склад, расположенный в Северо-',
    'западном районе города, в сроки, согласованные сторонами в спецификации к договору,',
    'а Покупатель обязуется принять товар и оплатить его в течение десяти дней.',
    '2. Прочие условия.',
  ];
  assert.equal(
    reflowPdfText(lines.join('\n')).split('\n\n')[0],
    'Поставщик обязуется поставить товар на склад, расположенный в Северо-западном районе города, в сроки, согласованные сторонами в спецификации к договору, а Покупатель обязуется принять товар и оплатить его в течение десяти дней.',
  );
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

test('pdf builder emits a valid single-file PDF', async () => {
  const pdf = await buildSimplePdf('Test report', [{ heading: 'Section' }, { text: 'Hello world '.repeat(120) }]);
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-'));
  assert.ok(s.includes('%%EOF'));
  assert.ok(s.includes('/Type /Page'));
});

test('pdf builder handles Cyrillic without producing "?" placeholders', async () => {
  // The whole point of the Unicode font: Russian/Uzbek/Kazakh reports must not
  // render as garbage. Embedding a real font means the bytes are subset+encoded
  // (no literal '?' substitution), and the doc is a well-formed PDF.
  const pdf = await buildSimplePdf('Отчёт по договору', [
    { heading: 'Резюме', text: 'Договор содержит условия о неустойке и расторжении. St.' },
  ]);
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-'));
  assert.ok(s.includes('%%EOF'));
  // A subset Unicode font is embedded (FontFile2 = embedded TrueType).
  assert.ok(s.includes('FontFile2'), 'embeds a TrueType font (Unicode support)');
  assert.ok(pdf.length > 1000, 'non-trivial PDF produced');
});

/** Extract word/document.xml from a .docx (ZIP) buffer — minimal local-header
 *  parser + raw inflate. Enough to inspect the generated Word XML in tests. */
function docxDocumentXml(buf: Buffer): string {
  const target = 'word/document.xml';
  let i = 0;
  while (i + 4 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break; // not a local file header
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('latin1', i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (name === target) {
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    }
    i = dataStart + compSize;
  }
  throw new Error('document.xml not found (data-descriptor zip?)');
}

test('docx export: tracked mode emits real Word revisions; clean mode flattens', async () => {
  const blocks = [
    { type: 'heading' as const, text: 'Clause 1' },
    { type: 'paragraph' as const, segments: ['Notice period of ', { redlineId: 'r1' }, ' applies.'] },
    { type: 'paragraph' as const, segments: ['Cap: ', { redlineId: 'r2' }, '.'] },
  ];
  const redlines = [
    { id: 'r1', delText: "one week's", insText: "one month's", severity: 'High' as const, status: 'pending' as const },
    { id: 'r2', delText: '12 months', insText: '6 months', severity: 'Medium' as const, status: 'rejected' as const },
  ];

  // Tracked: pending redline → w:ins + w:del; rejected → plain original text.
  const tracked = new Document({ sections: [{ children: buildDocxParagraphs('Doc', blocks, redlines, 'tracked', '2026-01-01T00:00:00Z') }] });
  const trackedXml = docxDocumentXml(await Packer.toBuffer(tracked));
  assert.ok(trackedXml.includes('<w:ins'), 'tracked mode inserts a w:ins revision');
  assert.ok(trackedXml.includes('<w:del'), 'tracked mode inserts a w:del revision');
  assert.ok(trackedXml.includes('Lexab'), 'revision author is Lexab');
  assert.ok(trackedXml.includes('one week') && trackedXml.includes('one month'), 'both del + ins text present');

  // Clean mode: no revisions; accepted → insText, rejected → original.
  const cleanXml = docxDocumentXml(
    await Packer.toBuffer(new Document({ sections: [{ children: buildDocxParagraphs('Doc', blocks, [
      { id: 'r1', delText: "one week's", insText: "one month's", severity: 'High' as const, status: 'accepted' as const },
      { id: 'r2', delText: '12 months', insText: '6 months', severity: 'Medium' as const, status: 'rejected' as const },
    ], 'clean', '2026-01-01T00:00:00Z') }] })),
  );
  assert.ok(!cleanXml.includes('<w:ins'), 'clean mode has no tracked insertions');
  assert.ok(!cleanXml.includes('<w:del'), 'clean mode has no tracked deletions');
  // (apostrophe may be XML-escaped, so match the stable part)
  assert.ok(cleanXml.includes('one month'), 'accepted change applied in clean copy');
  assert.ok(cleanXml.includes('12 months'), 'rejected change keeps original in clean copy');
});

test('docx export: user formatting (marks, align, lists, links) carries into Word', async () => {
  const blocks = [
    { type: 'heading' as const, text: 'Title', level: 1 as const },
    {
      type: 'paragraph' as const,
      align: 'center' as const,
      segments: [
        'plain ',
        { text: 'bold', marks: ['b' as const] },
        { text: 'italic', marks: ['i' as const] },
        { text: 'under', marks: ['u' as const] },
        { text: 'struck', marks: ['s' as const] },
        { text: 'site', href: 'https://example.com' },
      ],
    },
    { type: 'bullet' as const, segments: ['first point'] },
    { type: 'numbered' as const, segments: ['step one'] },
  ];
  const doc = new Document({
    numbering: DOCX_NUMBERING,
    sections: [{ children: buildDocxParagraphs('Doc', blocks, [], 'clean', '2026-01-01T00:00:00Z') }],
  });
  const xml = docxDocumentXml(await Packer.toBuffer(doc));
  assert.ok(xml.includes('<w:b/>') || xml.includes('<w:b '), 'bold run present');
  assert.ok(xml.includes('<w:i/>') || xml.includes('<w:i '), 'italic run present');
  assert.ok(xml.includes('<w:u '), 'underline run present');
  assert.ok(xml.includes('<w:strike'), 'strikethrough run present');
  assert.ok(xml.includes('w:val="center"'), 'center alignment present');
  assert.ok(xml.includes('<w:numPr>'), 'list items carry numbering/bullet properties');
  assert.ok(xml.includes('<w:hyperlink'), 'hyperlink present');
});

test('docx export: two separate numbered lists each restart (distinct numbering instances)', async () => {
  const blocks = [
    { type: 'numbered' as const, segments: ['a1'] },
    { type: 'numbered' as const, segments: ['a2'] },
    { type: 'paragraph' as const, segments: ['break'] },
    { type: 'numbered' as const, segments: ['b1'] },
  ];
  const doc = new Document({
    numbering: DOCX_NUMBERING,
    sections: [{ children: buildDocxParagraphs('Doc', blocks, [], 'clean', '2026-01-01T00:00:00Z') }],
  });
  const xml = docxDocumentXml(await Packer.toBuffer(doc));
  const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1]);
  assert.equal(numIds.length, 3, 'three numbered paragraphs reference numbering');
  assert.equal(numIds[0], numIds[1], 'the first two items share one instance');
  assert.notEqual(numIds[2], numIds[0], 'the second list uses a different instance (restarts)');
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
});

test('storage: local deleteFile is idempotent and stays inside uploads/', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lexab-storage-'));
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

test('llm provider routing: models route by id, not by config', () => {
  assert.equal(isDeepSeekModel('deepseek-v4-pro'), true);
  assert.equal(isDeepSeekModel('deepseek-chat'), true);
  assert.equal(isDeepSeekModel('deepseek-ai/DeepSeek-V3.2'), true); // western-host ids
  assert.equal(isDeepSeekModel('claude-haiku-5-5'), false);
  assert.equal(isDeepSeekModel('claude-opus-5-5'), false);
  assert.equal(isDeepSeekModel('claude-sonnet-5-5'), false);
});

test('models: per-model "no thinking" and refusal-fallback params (2026-10-21 switch)', () => {
  // Новое поколение: Haiku 4.5 / Sonnet 5 / Fable 5 / Opus 4.8 из кода убраны.
  assert.deepEqual(MODELS, { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' });
  // Как выключить размышления, у каждой модели своё; чужой способ = 400.
  assert.deepEqual(noThinking('claude-haiku-5-5'), { thinking: { type: 'disabled' } });
  assert.deepEqual(noThinking('claude-sonnet-5-5'), { thinking: { type: 'between_tools' } });
  assert.deepEqual(noThinking('claude-opus-5-5'), {}); // выключить нельзя вовсе
  assert.deepEqual(noThinking('deepseek-v4-pro'), {});
  // Серверная страховка от ложного отказа — у Opus/Sonnet 5.5; у Haiku 5.5 её нет (400).
  const fb = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  assert.deepEqual(serverFallback('claude-opus-5-5'), fb);
  assert.deepEqual(serverFallback('claude-sonnet-5-5'), fb);
  assert.deepEqual(serverFallback('claude-haiku-5-5'), {});
});

test('extractJsonObject: plain, fenced, prose-wrapped and broken JSON', () => {
  assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('Here is the result:\n{"a":{"b":[1,2]}}'), { a: { b: [1, 2] } });
  assert.throws(() => extractJsonObject('no json here'));
  assert.throws(() => extractJsonObject('{"broken": '));
});

test('parseDriveLink: file/doc/open/uc forms, junk rejected', async () => {
  const { parseDriveLink, filenameFromDisposition } = await import('../src/lib/driveLink.ts');
  assert.deepEqual(parseDriveLink('https://drive.google.com/file/d/1AbC_dEf-234567890/view?usp=sharing'), {
    id: '1AbC_dEf-234567890',
    kind: 'file',
  });
  assert.deepEqual(parseDriveLink('https://drive.google.com/open?id=1AbC_dEf-234567890'), {
    id: '1AbC_dEf-234567890',
    kind: 'file',
  });
  assert.deepEqual(parseDriveLink('https://docs.google.com/document/d/1AbC_dEf-234567890/edit'), {
    id: '1AbC_dEf-234567890',
    kind: 'doc',
  });
  assert.equal(parseDriveLink('https://evil.example.com/file/d/1AbC_dEf-234567890'), null);
  assert.equal(parseDriveLink('not a url'), null);
  assert.equal(parseDriveLink('https://drive.google.com/drive/my-drive'), null);
  assert.equal(filenameFromDisposition('attachment; filename="NDA v2.pdf"'), 'NDA v2.pdf');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''%D0%94%D0%BE%D0%B3.pdf"), 'Дог.pdf');
  assert.equal(filenameFromDisposition(null), null);
});

test('recalibrateRisk: потолок балла по фактической максимальной severity', async () => {
  const { recalibrateRisk } = await import('../src/lib/riskScore.ts');
  const f = (...sev: ('High' | 'Medium' | 'Low')[]) => sev.map((severity) => ({ severity }));

  // нет находок → cap 20, Low
  assert.deepEqual(recalibrateRisk([], 85), { riskScore: 20, riskLevel: 'Low' });
  // только Low (включая демотированные валидатором) → cap 40
  assert.deepEqual(recalibrateRisk(f('Low', 'Low', 'Low'), 78), { riskScore: 40, riskLevel: 'Elevated' });
  // максимум Medium → cap 65
  assert.deepEqual(recalibrateRisk(f('Medium', 'Low'), 90), { riskScore: 65, riskLevel: 'Elevated' });
  // High → балл не режется
  assert.deepEqual(recalibrateRisk(f('High', 'Low'), 88), { riskScore: 88, riskLevel: 'High' });
  // балл ниже потолка не трогается
  assert.deepEqual(recalibrateRisk(f('Medium'), 50), { riskScore: 50, riskLevel: 'Elevated' });
  // после демоции High→Low высокая «шапка» падает
  assert.deepEqual(recalibrateRisk(f('Low', 'Low'), 72), { riskScore: 40, riskLevel: 'Elevated' });
  // riskLevel согласован с итоговым баллом (<34 Low)
  assert.deepEqual(recalibrateRisk(f('Low'), 25), { riskScore: 25, riskLevel: 'Low' });
});

test('totp: generated codes verify, drift tolerated, wrong codes rejected', async () => {
  const { generateTotpSecret, totpCode, verifyTotp, base32Decode, base32Encode } = await import('../src/lib/totp.ts');
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000; // fixed instant → deterministic
  const code = totpCode(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.ok(verifyTotp(secret, code, now), 'the current code verifies');
  // ±1 step (±30s) of clock drift is tolerated
  assert.ok(verifyTotp(secret, totpCode(secret, now - 30_000), now), 'previous step accepted');
  assert.ok(verifyTotp(secret, totpCode(secret, now + 30_000), now), 'next step accepted');
  // two steps away is rejected
  assert.ok(!verifyTotp(secret, totpCode(secret, now + 90_000), now), 'far code rejected');
  assert.ok(!verifyTotp(secret, '000000', now) || totpCode(secret, now) === '000000', 'wrong code rejected');
  // base32 round-trips
  const bytes = Buffer.from('lexab-totp-secret-1');
  assert.equal(base32Decode(base32Encode(bytes)).toString(), bytes.toString());
});

test('backup codes: hash is stable, distinct, and case/space-insensitive', async () => {
  const { generateBackupCodes, hashBackupCode } = await import('../src/lib/totp.ts');
  const codes = generateBackupCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, 'all distinct');
  const h = hashBackupCode(codes[0]);
  assert.equal(h, hashBackupCode(codes[0].toUpperCase()), 'case-insensitive');
  assert.equal(h, hashBackupCode(` ${codes[0]} `), 'trims whitespace');
  assert.notEqual(h, hashBackupCode(codes[1]), 'different codes → different hashes');
});
