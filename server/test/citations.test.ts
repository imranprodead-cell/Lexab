/* Юнит-тесты чистого разбора русских цитат (parseRuCitation, retrieve.ts):
   алиасы актов УЗ, юникод-границы аббревиатур, fail-closed, KZ без изменений. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuCitation } from '../src/rag/retrieve.ts';

const uz = (c: string) => parseRuCitation(c, 'UZ');
const kz = (c: string) => parseRuCitation(c, 'KZ');

test('ГК: аббревиатура и развёрнуто', () => {
  assert.deepEqual(uz('ст. 260 ГК'), { number: '260', titlePattern: 'Гражданский кодекс%' });
  assert.deepEqual(uz('статья 386 Гражданского кодекса'), { number: '386', titlePattern: 'Гражданский кодекс%' });
});

test('аббревиатура не ловится внутри слова', () => {
  assert.equal(uz('ст. 5 ЗГКО'), null);
  assert.equal(uz('ст. 10 устава ЗАО'), null); // АО внутри ЗАО не считается
});

test('ТК: аббревиатура и развёрнуто', () => {
  assert.deepEqual(uz('ст. 130 ТК'), { number: '130', titlePattern: '%Трудовой кодекс%' });
  assert.deepEqual(uz('статья 160 Трудового кодекса РУз'), { number: '160', titlePattern: '%Трудовой кодекс%' });
});

test('ЭПК: аббревиатура и развёрнуто', () => {
  assert.equal(uz('ст. 94 ЭПК')?.titlePattern, '%Экономический процессуальный кодекс%');
  assert.equal(uz('ст. 34 Экономического процессуального кодекса')?.titlePattern, '%Экономический процессуальный кодекс%');
});

test('кавычки выигрывают у алиасов', () => {
  assert.deepEqual(uz('ст. 36 Закона «Об ипотеке»'), { number: '36', titlePattern: '%Об ипотеке%' });
  assert.deepEqual(uz('ст. 14 Закона "О защите прав потребителей"'), { number: '14', titlePattern: '%О защите прав потребителей%' });
});

test('ипотека специфичнее залога', () => {
  assert.equal(uz('ст. 6 закона об ипотеке (залог недвижимости)')?.titlePattern, '%Об ипотеке%');
  assert.equal(uz('ст. 19 закона о залоге')?.titlePattern, '%О залоге%');
});

test('ООО и АО', () => {
  assert.equal(uz('ст. 21 Закона об ООО')?.titlePattern, '%с ограниченной ответственностью%');
  assert.equal(uz('ст. 21 закона об обществах с ограниченной ответственностью')?.titlePattern, '%с ограниченной ответственностью%');
  assert.equal(uz('ст. 28 закона об акционерных обществах')?.titlePattern, '%Об акционерных обществах%');
  assert.equal(uz('ст. 28 АО')?.titlePattern, '%Об акционерных обществах%');
});

test('аренда, ЭЦП, ЗоЗПП, договорно-правовая база', () => {
  assert.equal(uz('ст. 16 закона об аренде')?.titlePattern, '%Об аренде%');
  assert.equal(uz('ст. 4 закона об ЭЦП')?.titlePattern, '%Об электронной цифровой подписи%');
  assert.equal(uz('ст. 4 об электронной цифровой подписи')?.titlePattern, '%Об электронной цифровой подписи%');
  assert.equal(uz('ст. 5 ЗоЗПП')?.titlePattern, '%О защите прав потребителей%');
  assert.equal(uz('ст. 11 о договорно-правовой базе')?.titlePattern, '%О договорно-правовой базе%');
});

test('составные номера статей', () => {
  assert.equal(uz('ст. 183-1 ЭПК')?.number, '183-1');
  assert.equal(uz('статья 974.2 ГК')?.number, '974.2');
});

test('fail-closed: нет статьи или нет акта → null', () => {
  assert.equal(uz('Закон об ипотеке'), null); // нет «ст. N»
  assert.equal(uz('ст. 5 неизвестного акта'), null); // ни один алиас
  assert.equal(parseRuCitation('ст. 5 ГК', 'XX'), null); // неизвестная юрисдикция
});

test('KZ: прежнее поведение байт-в-байт — кавычки и «Гражданск…», больше ничего', () => {
  assert.deepEqual(kz('статья 401 Гражданского кодекса РК'), { number: '401', titlePattern: 'Гражданский кодекс%' });
  assert.equal(kz('ст. 401 ГК РК'), null); // прежний \bГК\b на кириллице не работал — сохранено
  assert.equal(kz('ст. 10 закона об ЭЦП'), null); // KZ-алиасов нет
  assert.equal(kz('ст. 7 Закона «О защите прав потребителей»')?.titlePattern, '%О защите прав потребителей%');
});
