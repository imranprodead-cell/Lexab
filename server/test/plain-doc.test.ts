/**
 * Выгрузка документа из боковой панели чата в Word/PDF (lib/plainDoc.ts):
 * таблица протокола разногласий — настоящей таблицей Word, а не рядами «|».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { Packer } from 'docx';
import { boldRuns, columnWidths, parsePlainDoc, plainDocToDocx, plainDocToPdfSections } from '../src/lib/plainDoc.ts';

const PROTOCOL = `# Протокол разногласий
к договору поставки № 45/10 от 01.09.2026

| № | Пункт | Редакция договора | Наша редакция | Обоснование |
|---|---|---|---|---|
| 1 | п. 5 | Пеня 1% в день | Пеня 0,4% в день,<br>не более 50% | **ст. 32** Закона № 670-I |
| 2 | п. 4 | Срок определяет Поставщик | 10 дней | ст. 25 |

Поставщик: ________   Покупатель: ________`;

/** document.xml из .docx (zip: локальные заголовки + deflate). */
function documentXml(buf: Buffer): string {
  for (let off = 0; off < buf.length - 4; ) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString();
    const data = buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + compSize);
    if (name === 'word/document.xml') return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    off += 30 + nameLen + extraLen + compSize;
  }
  return '';
}

describe('plain document → Word / PDF', () => {
  it('finds headings, paragraphs and a table with its header and rows', () => {
    const blocks = parsePlainDoc(PROTOCOL);
    assert.deepEqual(blocks[0], { kind: 'heading', text: 'Протокол разногласий', level: 1 });
    const table = blocks.find((b) => b.kind === 'table');
    assert.ok(table && table.kind === 'table');
    assert.deepEqual(table.header, ['№', 'Пункт', 'Редакция договора', 'Наша редакция', 'Обоснование']);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0][4], '**ст. 32** Закона № 670-I');
    assert.ok(blocks.some((b) => b.kind === 'para' && b.text.startsWith('Поставщик:')));
  });

  it('is not fooled by lines with pipes that are not a table', () => {
    const blocks = parsePlainDoc('a | b | c\nобычный текст | без разделителя |');
    assert.ok(blocks.every((b) => b.kind === 'para'));
    assert.deepEqual(boldRuns('Сумма **108 000 000** сум'), [
      { text: 'Сумма ', bold: false },
      { text: '108 000 000', bold: true },
      { text: ' сум', bold: false },
    ]);
  });

  it('Word gets a REAL table (w:tbl) with the cells, no raw pipe rows', async () => {
    const xml = documentXml(await Packer.toBuffer(plainDocToDocx('Протокол разногласий', PROTOCOL)));
    assert.ok(xml.length > 0, 'document.xml найден');
    assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1, 'одна таблица');
    assert.equal((xml.match(/<w:tr[ >]/g) ?? []).length, 3, 'шапка + 2 строки');
    for (const cell of ['Редакция договора', 'Пеня 0,4% в день,', 'не более 50%', 'Срок определяет Поставщик']) assert.ok(xml.includes(cell), cell);
    assert.ok(!xml.includes('|---'), 'разделитель таблицы не попал в текст');
    assert.ok(!xml.includes('| 1 |'), 'строки таблицы не остались текстом с «|»');
    assert.ok(!xml.includes('**'), 'жирное — форматированием, а не звёздочками');
    assert.ok(xml.includes('<w:b/>'), 'есть жирный текст');
  });

  it('PDF lays the table out row by row as «column: value»', () => {
    const sections = plainDocToPdfSections(PROTOCOL);
    assert.deepEqual(sections[0], { heading: 'Протокол разногласий' });
    assert.ok(sections.some((s) => s.heading === '№ 1'));
    assert.ok(sections.some((s) => s.text === 'Наша редакция: Пеня 0,4% в день, не более 50%'));
    assert.ok(sections.some((s) => s.text === 'Обоснование: ст. 32 Закона № 670-I'));
    assert.ok(!sections.some((s) => (s.text ?? '').includes('|')));
  });

  it('plain text without markup comes out as before — one paragraph per line', () => {
    const blocks = parsePlainDoc('Претензия\n\nТребуем оплатить долг.');
    assert.deepEqual(blocks, [
      { kind: 'para', text: 'Претензия' },
      { kind: 'para', text: '' },
      { kind: 'para', text: 'Требуем оплатить долг.' },
    ]);
  });

  it('keeps «___» signature and date blanks (not markup) and a single title', async () => {
    assert.deepEqual(boldRuns('«___» ________ 2026 г.'), [{ text: '«___» ________ 2026 г.', bold: false }]);
    const xml = documentXml(await Packer.toBuffer(plainDocToDocx('Протокол разногласий', PROTOCOL + '\n«___» ________ 2026 г.')));
    assert.ok(xml.includes('«___» ________ 2026 г.'));
    assert.equal((xml.match(/Протокол разногласий/g) ?? []).length, 1, 'заголовок не повторяется');
  });

  it('column widths fill the page and never squeeze a header word', () => {
    const table = parsePlainDoc(PROTOCOL).find((b) => b.kind === 'table');
    assert.ok(table && table.kind === 'table');
    const w = columnWidths(table);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 9000) < 10, 'вся ширина страницы');
    assert.ok(w[1] >= 5 * 130, '«Пункт» не рвётся');
    assert.ok(w[4] >= 11 * 130, '«Обоснование» не рвётся');
    assert.ok(w[2] > w[0] && w[3] > w[1], 'текстовые колонки шире «№» и «Пункт»');
  });

  it('a bilingual RU + UZ contract becomes a two-column Word table with both languages side by side', async () => {
    const BI = `# Договор поставки / Yetkazib berish shartnomasi

| Русский | Oʻzbekcha |
|---|---|
| **1. Предмет договора**<br>Поставщик передаёт Покупателю товар. | **1. Shartnoma predmeti**<br>Yetkazib beruvchi Xaridorga tovarni topshiradi. |
| 2. Цена — 240 000 000 сум. | 2. Narxi — 240 000 000 soʻm. |
| 3. При расхождении текстов приоритет имеет текст на [языке]. | 3. Matnlar oʻrtasida farq boʻlsa, [til]dagi matn ustun hisoblanadi. |`;
    const table = parsePlainDoc(BI).find((b) => b.kind === 'table');
    assert.ok(table && table.kind === 'table');
    const w = columnWidths(table);
    assert.equal(w.length, 2);
    assert.ok(Math.abs(w[0] - w[1]) < 1500, 'колонки примерно поровну');
    const xml = documentXml(await Packer.toBuffer(plainDocToDocx('Договор поставки / Yetkazib berish shartnomasi', BI)));
    assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1);
    assert.equal((xml.match(/<w:tr[ >]/g) ?? []).length, 4, 'шапка + 3 пункта');
    for (const t of ['Поставщик передаёт Покупателю товар.', 'Yetkazib beruvchi Xaridorga tovarni topshiradi.', 'Narxi — 240 000 000 soʻm.']) assert.ok(xml.includes(t), t);
    assert.equal((xml.match(/Yetkazib berish shartnomasi/g) ?? []).length, 1, 'заголовок один');
  });
});
