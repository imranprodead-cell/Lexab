/**
 * Заголовок чата (lib/chatTitle.ts): ответ модели → чистый заголовок; без
 * модели — начало вопроса.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { cleanTitle, titleFallback } = await import('../src/lib/chatTitle.ts');

describe('заголовок чата', () => {
  it('ответ модели: одна строка без кавычек, Markdown и точки', () => {
    assert.equal(cleanTitle('«Неустойка по договору поставки».'), 'Неустойка по договору поставки');
    assert.equal(cleanTitle('**Регистрация ООО иностранцем**\nДоп. строка'), 'Регистрация ООО иностранцем');
    assert.equal(cleanTitle('Title: Lease termination notice'), 'Lease termination notice');
    assert.equal(cleanTitle('Заголовок: "Взыскание долга"'), 'Взыскание долга');
    assert.equal(cleanTitle(''), null);
    assert.equal(cleanTitle('  \n "" '), null);
    assert.equal(cleanTitle(null), null);
  });

  it('длинный заголовок режется по слову', () => {
    const t = cleanTitle('Очень длинный заголовок про порядок государственной регистрации автомототранспортных средств в Узбекистане') as string;
    assert.ok(t.length <= 60 && t.endsWith('…') && !/\s…$/.test(t), t);
  });

  it('без модели — начало вопроса с заглавной буквы, одной строкой', () => {
    assert.equal(titleFallback('какая неустойка\nза просрочку?'), 'Какая неустойка за просрочку?');
    assert.ok(titleFallback('а'.repeat(100)).length <= 60);
  });
});
