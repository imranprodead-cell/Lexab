/**
 * Excel и PowerPoint как вложения чата (2026-10-25): текст таблиц и слайдов
 * для модели. Файлы собираются здесь же из XML — так проверяются и порядок
 * листов/слайдов из книги, и даты, которые Excel хранит числом.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pptxToText, xlsxToText } from '../src/lib/officeText.ts';
import { ATTACHMENT_EXTENSIONS, ALLOWED_EXTENSIONS, extractText, verifyFileSignature } from '../src/extract.ts';
import { zipStore } from './zip-helper.ts';

const XL_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

function xlsx(sheets: { name: string; file: string; xml: string; hidden?: boolean }[], extra: Record<string, string> = {}): Buffer {
  const workbook = `<?xml version="1.0"?><workbook ${XL_NS}><sheets>${sheets
    .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships ${REL_NS}>${sheets
    .map((s, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/${s.file}"/>`)
    .join('')}</Relationships>`;
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': rels,
    ...extra,
  };
  for (const s of sheets) files[`xl/worksheets/${s.file}`] = `<?xml version="1.0"?><worksheet ${XL_NS}><sheetData>${s.xml}</sheetData></worksheet>`;
  return zipStore(files);
}

const SHARED = `<?xml version="1.0"?><sst ${XL_NS}><si><t>Поставщик</t></si><si><t>Сумма</t></si><si><r><t>ООО </t></r><r><t>«Альфа»</t></r></si><si><t>Срок</t></si></sst>`;
// Стиль 1 — встроенный формат даты 14, стиль 2 — свой «dd.mm.yyyy», стиль 3 — деньги.
const STYLES = `<?xml version="1.0"?><styleSheet ${XL_NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="# ##0 &quot;сум&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`;

test('xlsxToText: shared and inline strings, numbers, dates, booleans, gaps', () => {
  const sheet = [
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="3"><v>1200000</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="2"><v>46320</v></c></row>',
    '<row r="3"><c r="A3" t="inlineStr"><is><t>Итого</t></is></c><c r="B3" s="1"><v>45658</v></c><c r="C3"><f>SUM(B2)</f><v>1200000</v></c></row>',
    '<row r="4"></row>',
  ].join('');
  const text = xlsxToText(
    xlsx([{ name: 'Сроки', file: 'sheet1.xml', xml: sheet }], { 'xl/sharedStrings.xml': SHARED, 'xl/styles.xml': STYLES }),
  );
  assert.equal(
    text,
    [
      '## Лист: Сроки',
      'Поставщик | Сумма |  | Срок', // пустая C1 сохраняет столбцы на месте
      'ООО «Альфа» | 1200000 | TRUE | 2026-10-25', // деньги — числом, дата — датой
      'Итого | 2025-01-01 | 1200000', // формула — её значение, а не «SUM(B2)»
    ].join('\n'),
  );
});

test('xlsxToText: sheets in workbook order, hidden ones marked, empty ones skipped', () => {
  const row = (v: string) => `<row r="1"><c r="A1" t="inlineStr"><is><t>${v}</t></is></c></row>`;
  const text = xlsxToText(
    xlsx([
      { name: 'Итоги', file: 'sheet3.xml', xml: row('первый по книге') },
      { name: 'Пустой', file: 'sheet1.xml', xml: '' },
      { name: 'Служебный', file: 'sheet2.xml', xml: row('скрытые данные'), hidden: true },
    ]),
  );
  assert.equal(text, '## Лист: Итоги\nпервый по книге\n\n## Лист: Служебный (скрытый)\nскрытые данные');
});

test('xlsxToText: not a workbook → null', () => {
  assert.equal(xlsxToText(zipStore({ 'word/document.xml': '<w:document/>' })), null);
  assert.equal(xlsxToText(Buffer.from('not a zip at all')), null);
});

const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const slide = (paras: string[]) =>
  `<?xml version="1.0"?><p:sld ${P_NS}><p:cSld><p:spTree><p:sp><p:txBody>${paras.join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

test('pptxToText: slides in show order, paragraphs and line breaks', () => {
  const buf = zipStore({
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${P_NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`,
    // slide2.xml показывается ПЕРВЫМ — его переставили в PowerPoint.
    'ppt/slides/slide2.xml': slide(['<a:p><a:r><a:t>Позиция по делу</a:t></a:r></a:p>', '<a:p><a:r><a:t>Сумма: </a:t></a:r><a:r><a:t>1 200 000 сум</a:t></a:r></a:p>']),
    'ppt/slides/slide1.xml': slide(['<a:p><a:r><a:t>Риски</a:t></a:r><a:br/><a:r><a:t>и как их снизить</a:t></a:r></a:p>', '<a:p/>']),
  });
  assert.equal(pptxToText(buf), '## Слайд 1\nПозиция по делу\nСумма: 1 200 000 сум\n\n## Слайд 2\nРиски\nи как их снизить');
});

test('pptxToText: slides without any text → null', () => {
  const buf = zipStore({
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${P_NS}/>`,
    'ppt/slides/slide1.xml': slide([]),
  });
  assert.equal(pptxToText(buf), null);
});

test('chat attachments accept Excel/PowerPoint/CSV; contract formats stay as they were', () => {
  assert.deepEqual(ALLOWED_EXTENSIONS, ['.pdf', '.doc', '.docx', '.txt', '.md']);
  for (const ext of ['.xlsx', '.pptx', '.csv']) {
    assert.ok(ATTACHMENT_EXTENSIONS.includes(ext), ext);
    assert.ok(!ALLOWED_EXTENSIONS.includes(ext), `${ext} must not reach risk review`);
  }
  const zip = zipStore({ 'a.xml': '<a/>' });
  assert.ok(verifyFileSignature(zip, 'Сроки.xlsx'));
  assert.ok(verifyFileSignature(zip, 'Позиция.pptx'));
  assert.ok(!verifyFileSignature(Buffer.from('%PDF-1.4'), 'renamed.xlsx'), 'a renamed PDF is not a workbook');
  assert.ok(verifyFileSignature(Buffer.from('a;b\n1;2'), 'data.csv'));
  assert.ok(!verifyFileSignature(Buffer.from([0x4d, 0x5a, 0x00, 0x00]), 'evil.csv'), 'binary payload is not CSV');
});

test('extractText: .xlsx, .pptx and .csv; unreadable workbook → clear 400', async () => {
  const book = xlsx([{ name: 'Лист1', file: 'sheet1.xml', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>Неустойка</t></is></c></row>' }]);
  assert.equal(await extractText(book, 'Расчёт.xlsx'), '## Лист: Лист1\nНеустойка');
  assert.equal(await extractText(Buffer.from('Товар;Сумма\nЦемент;100', 'utf8'), 'data.csv'), 'Товар;Сумма\nЦемент;100');
  await assert.rejects(
    () => extractText(zipStore({ 'xl/workbook.xml': `<workbook ${XL_NS}><sheets/></workbook>` }), 'Пустая.xlsx'),
    (err: Error & { statusCode?: number; status?: number }) => /Не удалось прочитать текст/.test(err.message),
  );
});
