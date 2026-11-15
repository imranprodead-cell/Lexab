/** Противоречия внутри договора: цитаты принимаются только дословные. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normQuote, parseConflict, parseTopic, verifyConflicts } from '../src/lib/conflicts.ts';

const TEXT = `2.1. Общая стоимость Товара по Договору составляет 150 000 000 (сто миллионов) сум, включая НДС.
4.2. Покупатель оплачивает Товар в течение 30 (тридцати) календарных дней с даты поставки.
8.3. Оплата поставленного Товара производится не позднее 60 (шестидесяти) банковских дней с даты подписания товарной накладной.`;

describe('conflicts', () => {
  it('keeps a contradiction whose both quotes are verbatim (spacing, quotes and ё do not matter)', () => {
    const [f] = verifyConflicts([{ title: 't', conflict: { a: 'в течение 30 (тридцати)   календарных дней', b: 'не позднее 60 (шестидесяти) банковских дней' } }], TEXT);
    assert.ok(f.conflict, 'verbatim quotes are kept');
  });

  it('drops the contradiction mark when a quote is paraphrased (never show invented contract text)', () => {
    const [f] = verifyConflicts([{ title: 't', conflict: { a: 'оплата в течение месяца', b: 'не позднее 60 (шестидесяти) банковских дней' } }], TEXT);
    assert.equal(f.conflict, null);
    assert.equal(f.title, 't', 'the finding itself stays');
  });

  it('without contract text (scan) nothing can be checked — the mark is dropped', () => {
    const [f] = verifyConflicts([{ conflict: { a: '150 000 000', b: 'сто миллионов' } }], null);
    assert.equal(f.conflict, null);
  });

  it('parseConflict rejects empty, identical and oversized quotes and strips wrapping quotes', () => {
    assert.equal(parseConflict({ a: 'abc', b: 'abcdef' }), null);
    assert.equal(parseConflict({ a: 'одинаково', b: 'Одинаково' }), null);
    assert.equal(parseConflict({ a: 'x'.repeat(500), b: 'другое значение' }), null);
    assert.deepEqual(parseConflict({ a: '«150 000 000»', b: '"сто миллионов"' }), { a: '150 000 000', b: 'сто миллионов' });
    assert.equal(parseConflict(null), null);
  });

  it('parseTopic accepts only the six topics', () => {
    assert.equal(parseTopic('payment'), 'payment');
    assert.equal(parseTopic('Payment'), null);
    assert.equal(parseTopic(undefined), null);
  });

  it('normQuote unifies quotes, dashes and ё', () => {
    assert.equal(normQuote('«Ёлка» — ТЕСТ'), normQuote('"елка" - тест'));
  });
});
