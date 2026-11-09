/**
 * Стороны договора по шапке (lib/contractParties.ts) — для вопроса «Чью сторону
 * вы представляете?» перед разбором.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { extractParties, sideFromText, sideOfRole } = await import('../src/lib/contractParties.ts');

describe('стороны договора', () => {
  it('русская шапка: названия и роли', () => {
    const text =
      'ДОГОВОР ПОСТАВКИ № 45\nг. Ташкент «12» марта 2025 г.\nООО «Альфа Трейд», именуемое в дальнейшем «Поставщик», в лице директора Каримова А., действующего на основании Устава, с одной стороны, и ООО «Лексаб Тест», именуемое в дальнейшем «Покупатель», с другой стороны, заключили настоящий договор.';
    assert.deepEqual(extractParties(text), [
      { role: 'Поставщик', name: 'ООО «Альфа Трейд»', side: 'seller' },
      { role: 'Покупатель', name: 'ООО «Лексаб Тест»', side: 'buyer' },
    ]);
  });

  it('узбекская и английская шапка; роль без пары в списке — тоже вариант', () => {
    const uz = extractParties('«Alfa» MChJ, bundan buyon «Sotuvchi» deb ataladi, va «Beta» MChJ, bundan buyon «Xaridor» deb ataladi');
    assert.deepEqual(uz.map((p) => [p.role, p.side]), [['Sotuvchi', 'seller'], ['Xaridor', 'buyer']]);
    const en = extractParties('Alpha LLC (hereinafter referred to as the "Agent") and Beta Ltd (hereinafter "Principal")');
    assert.deepEqual(en.map((p) => [p.role, p.side]), [['Agent', null], ['Principal', null]]);
  });

  it('повтор роли в тексте — один вариант; без формулы — сторон нет', () => {
    const text = 'ИП Иванов, именуемый в дальнейшем «Арендатор», … Арендатор, далее «Арендатор», обязуется… ООО «Дом», именуемое в дальнейшем «Арендодатель»';
    assert.deepEqual(extractParties(text).map((p) => p.side), ['lessee', 'lessor']);
    assert.deepEqual(extractParties('Просто текст без сторон.'), []);
  });

  it('свободный ответ пользователя → роль, если однозначно', () => {
    assert.equal(sideFromText('мы покупатель, важно снизить предоплату'), 'buyer');
    assert.equal(sideFromText('я арендатор'), 'lessee');
    assert.equal(sideFromText('покупатель или поставщик — не знаю'), null);
    assert.equal(sideFromText('проверь штрафы'), null);
    assert.equal(sideOfRole('Субподрядчик'), 'contractor');
  });
});
