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
import { parseLexUzHtml, parseLexUzDecreeHtml, parseLexUzPlenumHtml, romanToInt } from '../src/rag/ingest/lex-uz.ts';

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

/** Минимальная страница lex.uz: <div class="CLS lx_elem"><div name id>текст</div></div>. */
const block = (cls: string, id: number, text: string) => `<div class="${cls} lx_elem"><div name="${id}" id="${id}">${text}</div></div>`;

test('Конституция: разделы словами и главы римскими (в т.ч. кириллицей) — только по флагу', () => {
  const html = [
    '<html><head><title>Конституция Республики Узбекистан</title></head><body>',
    block('TEXT_HEADER_DEFAULT', 1, 'РАЗДЕЛ ПЕРВЫЙ. ОСНОВНЫЕ ПРИНЦИПЫ'),
    block('TEXT_HEADER_DEFAULT', 2, 'Глава III. Верховенство Конституции и закона'),
    block('CLAUSE_DEFAULT', 3, 'Статья 15.'),
    block('ACT_TEXT', 4, 'Конституция имеет высшую юридическую силу.'),
    block('TEXT_HEADER_DEFAULT', 5, 'РАЗДЕЛ ЧЕТВЕРТЫЙ. УСТРОЙСТВО'),
    block('TEXT_HEADER_DEFAULT', 6, 'Глава ХIV. Семья'), // «Х» — кириллица
    block('CLAUSE_DEFAULT', 7, 'Статья 76.'),
    block('ACT_TEXT', 8, 'Семья находится под защитой.'),
    '</body></html>',
  ].join('\n');
  const url = 'https://lex.uz/ru/docs/9999004';

  const doc = parseLexUzHtml('9999004', html, url, { romanHeadings: true });
  const st15 = doc.units.find((u) => u.id === 'lu_uz_9999004_st-15')!;
  assert.equal(st15.breadcrumb, 'UZ / Конституция Республики Узбекистан / Раздел 1 / Глава 3 / ст.15');
  assert.equal(st15.parentId, 'lu_uz_9999004_glava-3');
  const st76 = doc.units.find((u) => u.id === 'lu_uz_9999004_st-76')!;
  assert.equal(st76.breadcrumb, 'UZ / Конституция Республики Узбекистан / Раздел 4 / Глава 14 / ст.76');
  assert.equal(doc.units.find((u) => u.id === 'lu_uz_9999004_glava-14')?.heading, 'Семья');

  // Без флага — прежнее поведение: такие шапки не создают юнитов.
  const plain = parseLexUzHtml('9999004', html, url);
  assert.equal(plain.units.filter((u) => u.unitType !== 'section').length, 0);
  assert.equal(plain.units.find((u) => u.id === 'lu_uz_9999004_st-15')?.breadcrumb, 'UZ / Конституция Республики Узбекистан / ст.15');
});

test('romanToInt: латиница, кириллические Х/І, мусор', () => {
  assert.equal(romanToInt('XIV'), 14);
  assert.equal(romanToInt('ХХVI'), 26);
  assert.equal(romanToInt('IХ'), 9);
  assert.equal(romanToInt('ABC'), null);
});

const plenumPage = (head: string, body: string) =>
  [
    '<html><head><title>163-сон 15.06.2007. О некоторых вопросах ответственности</title></head><body>',
    block('ACT_FORM', 1, 'Постановление'),
    `<div class="ACCEPTING_BODY lx_elem"><div class="lx_elem2"><div class="lx_elem3"><span>Предложения по документу</span></div></div><div name="2" id="2">${body}</div></div>`,
    `<div class="ACT_NUM" id="lx_lact_num_top">${head}</div>`,
    block('ACT_TEXT', 3, 'В целях единообразия практики Пленум ПОСТАНОВЛЯЕТ:'),
    block('ACT_TEXT', 4, '1. Судам следует руководствоваться Гражданским кодексом.'),
    block('ACT_TEXT', 5, '2. Неустойка может быть уменьшена судом.'),
    block('ACT_TEXT', 6, '2.1. Уменьшение допускается при явной несоразмерности.'),
    '</body></html>',
  ].join('\n');

test('Пленум: номер и суд из шапки, название с видом акта, doc_number', () => {
  const html = plenumPage('от 15.06.2007 г. № 163', 'пленума Высшего хозяйственного суда Республики Узбекистан');
  const doc = parseLexUzPlenumHtml('9999005', html, 'https://lex.uz/ru/docs/9999005', { court: 'ВХС', number: '163', date: '15.06.2007' });
  assert.equal(doc.docType, 'plenum');
  assert.equal(doc.docNumber, 'ПВХС-163-2007');
  assert.equal(doc.title, 'Постановление Пленума Высшего хозяйственного суда (ВХС) № 163 от 15.06.2007 «О некоторых вопросах ответственности»');
  const secs = doc.units.filter((u) => u.unitType === 'section');
  assert.deepEqual(secs.map((u) => u.number), ['1', '2', '2.1']);
  assert.ok(secs.every((u) => u.breadcrumb.startsWith(`UZ / ${doc.title} / п. `)));
  assert.equal(secs[0].validFrom, '2007-06-15');
  // Контрольная сумма пересчитана под новый breadcrumb.
  const raw = parseLexUzDecreeHtml('9999005', html, 'https://lex.uz/ru/docs/9999005');
  assert.notEqual(secs[0].sha256Checksum, raw.units[0].sha256Checksum);
});

test('Пленум: совместное постановление ВС и ВХС, ведущие нули в номере', () => {
  const html = plenumPage('от 22.12.2006 г. № 13/150', 'пленума Верховного суда Республики Узбекистан<br />пленума Высшего хозяйственного суда Республики Узбекистан');
  const doc = parseLexUzPlenumHtml('9999006', html, 'https://lex.uz/ru/docs/9999006', { court: 'ВС+ВХС', number: '13/150', date: '22.12.2006' });
  assert.equal(doc.docNumber, 'ПВС-ПВХС-13/150-2006');
  assert.ok(doc.title.startsWith('Совместное постановление Пленумов Верховного суда и Высшего хозяйственного суда (ВС и ВХС) № 13/150 от 22.12.2006'));
  const html2 = plenumPage('от 10.04.2009 г. № 06/196', 'пленума Верховного суда<br />пленума Высшего хозяйственного суда');
  assert.equal(parseLexUzPlenumHtml('9999007', html2, 'u', { court: 'ВС+ВХС', number: '06/196', date: '10.04.2009' }).docNumber, 'ПВС-ПВХС-6/196-2009');
});

test('Пленум: чужая страница — громкий отказ (номер, дата, суд)', () => {
  const html = plenumPage('от 15.06.2007 г. № 163', 'пленума Высшего хозяйственного суда Республики Узбекистан');
  const url = 'https://lex.uz/ru/docs/9999008';
  assert.throws(() => parseLexUzPlenumHtml('9999008', html, url, { court: 'ВХС', number: '164', date: '15.06.2007' }), /refusing/);
  assert.throws(() => parseLexUzPlenumHtml('9999008', html, url, { court: 'ВХС', number: '163', date: '16.06.2007' }), /refusing/);
  assert.throws(() => parseLexUzPlenumHtml('9999008', html, url, { court: 'ВС', number: '163', date: '15.06.2007' }), /refusing/);
});

test('вставные статьи и пункты <sup>: не склеиваются с соседними номерами', () => {
  const law = [
    '<html><head><title>Тестовый закон</title></head><body>',
    block('CLAUSE_DEFAULT', 1, 'Статья 1. Цель'),
    block('ACT_TEXT', 2, 'Текст статьи один.'),
    block('CLAUSE_DEFAULT', 3, 'Статья 1<sup>1</sup>. Сфера применения'),
    block('ACT_TEXT', 4, 'Текст вставной статьи.'),
    block('CLAUSE_DEFAULT', 5, 'Статья 11. Операции'),
    block('ACT_TEXT', 6, 'Текст статьи одиннадцать, площадь 5 м<sup>2</sup>.'),
    block('CLAUSE_DEFAULT', 7, 'Статья 27<sup>1.</sup> Точка внутри'),
    block('ACT_TEXT', 8, 'Текст.'),
    '</body></html>',
  ].join('\n');
  const doc = parseLexUzHtml('9999010', law, 'u');
  assert.deepEqual(doc.units.map((u) => u.number), ['1', '1-1', '11', '27-1']);
  assert.equal(doc.units.find((u) => u.number === '11')?.text, 'Текст статьи одиннадцать, площадь 5 м2.');
  assert.equal(doc.units.find((u) => u.number === '27-1')?.heading, 'Точка внутри');

  const dec = [
    '<html><head><title>01.01.2020. О тестовом указе</title></head><body>',
    '<div class="ACT_NUM" id="lx_lact_num_top">от 01.01.2020 г. № УП-9998</div>',
    block('ACT_TEXT', 1, '1. Первый пункт.'),
    block('ACT_TEXT', 2, '1<sup>1</sup>. Вставной пункт.'),
    block('ACT_TEXT', 3, '2. Второй пункт.'),
    block('ACT_TEXT', 4, '3. Третий пункт.'),
    '</body></html>',
  ].join('\n');
  const d = parseLexUzDecreeHtml('9999011', dec, 'u');
  assert.deepEqual(d.units.filter((u) => u.unitType === 'section').map((u) => u.number), ['1', '1-1', '2', '3']);
});

test('закон: повтор номера главы = приложение; подразделы римских разделов не совпадают', () => {
  const html = [
    '<html><head><title>Тестовый закон о структуре</title></head><body>',
    block('TEXT_HEADER_DEFAULT', 1, 'РАЗДЕЛ I. ОБЩАЯ ЧАСТЬ'),
    block('TEXT_HEADER_DEFAULT', 2, 'ПОДРАЗДЕЛ 1. Основы'),
    block('TEXT_HEADER_DEFAULT', 3, 'Глава 1. Общие положения'),
    block('CLAUSE_DEFAULT', 4, 'Статья 1. Цель'),
    block('ACT_TEXT', 5, 'Текст статьи закона.'),
    block('TEXT_HEADER_DEFAULT', 6, 'РАЗДЕЛ II. ОСОБЕННАЯ ЧАСТЬ'),
    block('TEXT_HEADER_DEFAULT', 7, 'ПОДРАЗДЕЛ 1. Договоры'),
    block('TEXT_HEADER_DEFAULT', 8, 'Глава 2. Купля-продажа'),
    block('CLAUSE_DEFAULT', 9, 'Статья 2. Договор'),
    block('ACT_TEXT', 10, 'Текст второй статьи.'),
    block('ACT_TEXT', 11, 'ТРЕБОВАНИЯ к проектам'),
    block('TEXT_HEADER_DEFAULT', 12, 'Глава 1. Общие положения приложения'),
    block('ACT_TEXT', 13, '1. Пункт приложения, не текст закона.'),
    '</body></html>',
  ].join('\n');
  const doc = parseLexUzHtml('9999012', html, 'u');
  const ids = doc.units.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length, 'id уникальны');
  assert.ok(ids.includes('lu_uz_9999012_podrazdel-I-1') && ids.includes('lu_uz_9999012_podrazdel-II-1'));
  assert.equal(doc.units.find((u) => u.id === 'lu_uz_9999012_glava-1')?.heading, 'Общие положения');
  assert.equal(doc.units.find((u) => u.id === 'lu_uz_9999012_st-2')?.text, 'Текст второй статьи.\nТРЕБОВАНИЯ к проектам');
  assert.ok(!doc.units.some((u) => u.text.includes('Пункт приложения')));
});
