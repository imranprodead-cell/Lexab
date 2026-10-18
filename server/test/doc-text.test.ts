/**
 * Старый формат Word (.doc) — аудит загрузок 2026-10-18, решение владельца:
 * .doc читаем. Образцы в fixtures/ сделаны конвертером macOS (textutil) —
 * настоящие файлы Word 97 (составной OLE-файл с piece table).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractText, verifyFileSignature } from '../src/extract.ts';
import { cleanStory, docToText, readPlcPcd } from '../src/lib/docText.ts';

const fixture = (name: string) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name));

/** Копия файла и смещение FIB: поток WordDocument начинается с сектора с подписью 0xA5EC. */
function withFib(buf: Buffer): { copy: Buffer; fib: number } {
  const copy = Buffer.from(buf);
  for (let off = 512; off + 512 <= copy.length; off += 512) {
    if (copy.readUInt16LE(off) === 0xa5ec) return { copy, fib: off };
  }
  throw new Error('FIB not found');
}

test('.doc: русский и узбекский текст читается как есть', async () => {
  const text = await extractText(fixture('dogovor-ru-uz.doc'), 'dogovor.doc');
  assert.equal(
    text,
    'ДОГОВОР ПОСТАВКИ № 17\n\n3.1. За просрочку поставки Поставщик уплачивает неустойку 0,5% за каждый день.\n\nUzbek: shartnoma oʻz kuchiga kiradi.',
  );
});

test('.doc: таблица построчно, у ссылки — текст, а не код поля', () => {
  const text = docToText(fixture('agreement-table.doc')) ?? '';
  assert.ok(text.includes('Goods | Price\nCement | 1 500 000'), text);
  assert.ok(text.includes('See the official site for details.'), text);
  assert.ok(!text.includes('HYPERLINK'), 'код поля не попадает в текст');
});

test('.doc под паролем и Word 6/95 — сразу понятный отказ с подсказкой «сохраните как .docx»', async () => {
  const original = fixture('dogovor-ru-uz.doc');
  const enc = withFib(original);
  enc.copy.writeUInt16LE(enc.copy.readUInt16LE(enc.fib + 0x0a) | 0x0100, enc.fib + 0x0a); // fEncrypted
  await assert.rejects(extractText(enc.copy, 'secret.doc'), (err: Error & { status?: number }) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /защищён паролем/);
    return true;
  });

  const old = withFib(original);
  old.copy.writeUInt16LE(0x0065, old.fib + 2); // nFib Word 6/95
  await assert.rejects(extractText(old.copy, 'old.doc'), (err: Error & { status?: number }) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /Word 6\/95/);
    assert.match(err.message, /\.docx/);
    return true;
  });
});

test('.doc: повреждённый файл не роняет разбор — отказ с подсказкой', async () => {
  // Заголовок составного файла есть (проверка подписи пройдёт), дальше мусор.
  const junk = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(4096, 0xab)]);
  assert.ok(verifyFileSignature(junk, 'broken.doc'));
  assert.equal(docToText(junk), null);
  await assert.rejects(extractText(junk, 'broken.doc'), /\.docx/);
});

test('.doc: испорченная таблица кусков (отрицательный размер блока) не вешает сервер', () => {
  // Prc с размером −3: раньше разбор вставал на месте навсегда (pos += 3 + (−3)).
  const looping = Buffer.from([0x01, 0xfd, 0xff, 0x01, 0xfd, 0xff, 0x02, 0x10, 0, 0, 0]);
  const started = Date.now();
  assert.equal(readPlcPcd(looping, 0, looping.length), null);
  assert.ok(Date.now() - started < 1000);
  // Нормальная последовательность: Prc (2 байта данных) → Pcdt.
  const ok = Buffer.concat([Buffer.from([0x01, 0x02, 0x00, 0xaa, 0xbb, 0x02, 0x04, 0, 0, 0]), Buffer.from([1, 2, 3, 4])]);
  assert.deepEqual(readPlcPcd(ok, 0, ok.length), Buffer.from([1, 2, 3, 4]));
});

test('.doc: зацикленная цепочка DIFAT в большом файле — быстрый отказ, а не гигабайты памяти', () => {
  // 10 МБ: прежде цикл DIFAT шёл до числа секторов (~20 тыс. раз по 127 номеров)
  // и строил таблицу FAT на сотни миллионов записей — сервер падал без памяти.
  const doc = Buffer.alloc(10 * 1024 * 1024);
  fixture('dogovor-ru-uz.doc').copy(doc);
  doc.writeUInt32LE(1, 0x44); // первый сектор DIFAT — №1…
  doc.writeUInt32LE(1, (1 + 1) * 512 + 512 - 4); // …и он указывает сам на себя
  const started = Date.now();
  assert.equal(docToText(doc), null);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} мс`);
});

test('.doc: миллион незакрытых полей разбирается за линейное время', () => {
  const raw = '\u0013'.repeat(1_000_000) + 'хвост';
  const started = Date.now();
  assert.equal(cleanStory(raw, null), '');
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} мс`);
  // Обычное поле: код выброшен, результат остался.
  assert.equal(cleanStory('См. \u0013 HYPERLINK "x" \u0014сайт\u0015.', null), 'См. сайт.');
});
