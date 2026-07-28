/* Фикстурные тесты парсеров lex.uz (чистые функции, без сети и БД):
   - parseLexUzDecreeHtml: пункты УП/ПП, монотонный гейт (вложенные перечни не
     создают ложных пунктов), пропуск «(утратил силу)», приложения в своём
     неймспейсе prilK-p-N, извлечение doc_number из шапки, уникальность id;
   - parseLexUzHtml: материализованная гарантия «законы парсятся байт-в-байт» —
     структурный снапшот юнитов мини-кодекса (регресс любой правки в файле). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLexUzHtml, parseLexUzDecreeHtml } from '../src/rag/ingest/lex-uz.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

test('указ: пункты, вставной 4-1, утративший силу пропущен, приложение в своём неймспейсе', () => {
  const doc = parseLexUzDecreeHtml('9999001', fixture('lex-uz-decree.html'), 'https://lex.uz/ru/docs/9999001');

  assert.equal(doc.docType, 'decree');
  assert.equal(doc.docNumber, 'УП-9999');
  assert.equal(doc.title, 'О мерах по тестовой цифровой трансформации');

  const sections = doc.units.filter((u) => u.unitType === 'section');
  assert.deepEqual(
    sections.map((u) => u.id),
    [
      'lu_uz_9999001_p-1',
      'lu_uz_9999001_p-2',
      // п.3 «(утратил силу)» юнита не создаёт — fail-closed для цитат
      'lu_uz_9999001_p-4',
      'lu_uz_9999001_p-4-1',
      'lu_uz_9999001_pril1-p-1',
      'lu_uz_9999001_pril1-p-2',
    ],
  );

  const p2 = sections.find((u) => u.id === 'lu_uz_9999001_p-2')!;
  // Вложенный перечень «1. …» внутри п.2 приклеен к телу, а не стал пунктом.
  assert.equal(p2.text, 'Утвердить:\nпрограммы цифровой трансформации регионов;\n1. Первая вложенная программа перечня.');
  assert.equal(p2.number, '2');
  assert.equal(p2.breadcrumb, 'UZ / О мерах по тестовой цифровой трансформации / п. 2');
  // Мусор (CHANGES_ORIGINS, SIGNATURE) не попал в тела.
  assert.ok(!doc.units.some((u) => u.text.includes('в редакции Указа')));
  assert.ok(!doc.units.some((u) => u.text.includes('МИРЗИЁЕВ')));

  // Вставной пункт при том же базовом номере.
  const p41 = sections.find((u) => u.id === 'lu_uz_9999001_p-4-1')!;
  assert.equal(p41.number, '4-1');

  // Приложение: контейнер + пункты со своим неймспейсом и родителем.
  const pril = doc.units.find((u) => u.id === 'lu_uz_9999001_pril-1')!;
  assert.equal(pril.unitType, 'part');
  const a1 = sections.find((u) => u.id === 'lu_uz_9999001_pril1-p-1')!;
  assert.equal(a1.parentId, 'lu_uz_9999001_pril-1');
  assert.ok(a1.breadcrumb.includes('прил. 1'));
  assert.ok(a1.breadcrumb.endsWith('/ п. 1'));
  // Пункты основного текста — без родителя (это условие резолвера doc_number).
  assert.equal(p2.parentId, null);

  // Дата из шапки, провенанс на месте.
  assert.equal(sections[0].validFrom, '2020-10-05');
  assert.ok(sections.every((u) => u.sourceUrl && u.sha256Checksum && u.officialUnitUri));

  // id уникальны (инвариант парсера).
  assert.equal(new Set(doc.units.map((u) => u.id)).size, doc.units.length);
});

test('указ: документ без пунктов → громкий отказ', () => {
  const html = '<html><body><div class="ACT_TEXT lx_elem"><div name="1" id="1">Просто преамбула без пунктов.</div></div></body></html>';
  assert.throws(() => parseLexUzDecreeHtml('9999002', html, 'https://lex.uz/ru/docs/9999002'), /parsed 0 points/);
});

test('закон: структурный снапшот мини-кодекса (гарантия «байт-в-байт» для 47 актов)', () => {
  const doc = parseLexUzHtml('9999003', fixture('lex-uz-law.html'), 'https://lex.uz/ru/docs/9999003');

  assert.equal(doc.docType, 'code'); // «кодекс» в названии
  assert.equal((doc as { docNumber?: string | null }).docNumber ?? null, null); // законы без doc_number

  assert.deepEqual(
    doc.units.map((u) => ({ id: u.id, unitType: u.unitType, number: u.number, heading: u.heading, breadcrumb: u.breadcrumb, text: u.text })),
    [
      {
        id: 'lu_uz_9999003_razdel-I', unitType: 'part', number: 'I', heading: 'ОБЩИЕ ПОЛОЖЕНИЯ',
        breadcrumb: 'UZ / Тестовый кодекс Республики Узбекистан / Раздел I', text: '',
      },
      {
        id: 'lu_uz_9999003_glava-1', unitType: 'chapter', number: '1', heading: 'Основные начала',
        breadcrumb: 'UZ / Тестовый кодекс Республики Узбекистан / Раздел I / Глава 1', text: '',
      },
      {
        id: 'lu_uz_9999003_st-1', unitType: 'section', number: '1', heading: 'Отношения, регулируемые тестовым кодексом',
        breadcrumb: 'UZ / Тестовый кодекс Республики Узбекистан / Раздел I / Глава 1 / ст.1',
        text: 'Тестовый кодекс регулирует тестовые отношения.\nПравила применяются ко всем участникам.',
      },
      {
        id: 'lu_uz_9999003_st-2', unitType: 'section', number: '2', heading: 'Принципы',
        breadcrumb: 'UZ / Тестовый кодекс Республики Узбекистан / Раздел I / Глава 1 / ст.2',
        text: 'Стороны свободны в установлении прав.',
      },
    ],
  );
  // Контент приложения не попал в статьи (inAnnex-режим законов сохранён).
  assert.ok(!doc.units.some((u) => u.text.includes('не должен попасть')));
  assert.equal(doc.units[2].validFrom, '1995-03-01');
});
