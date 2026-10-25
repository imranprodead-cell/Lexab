import { describe, expect, it } from 'vitest';
import { answersMessage, displayText, extractQuestions, isPlanCommand, looksLikePlan } from './questions';

const REPLY = `Неустойку взыскать можно, но размер зависит от договора.

\`\`\`questions
? Чью сторону вы представляете?
- Поставщика
- Покупателя
? Есть ли в договоре **обязательный** претензионный порядок?
- Да
- Нет
- Не знаю
\`\`\``;

describe('extractQuestions', () => {
  it('вырезает блок и разбирает вопросы с вариантами', () => {
    const r = extractQuestions(REPLY);
    expect(r.body).toBe('Неустойку взыскать можно, но размер зависит от договора.');
    expect(r.questions).toEqual([
      { question: 'Чью сторону вы представляете?', options: ['Поставщика', 'Покупателя'] },
      { question: 'Есть ли в договоре обязательный претензионный порядок?', options: ['Да', 'Нет', 'Не знаю'] },
    ]);
  });

  it('прячет недописанный блок, пока ответ печатается', () => {
    const streaming = 'Предварительно: да.\n\n```questions\n? Чью сто';
    const r = extractQuestions(streaming);
    expect(r.body).toBe('Предварительно: да.');
    expect(r.body).not.toContain('```');
  });

  it('без блока возвращает текст как есть', () => {
    expect(extractQuestions('Обычный ответ.')).toEqual({ body: 'Обычный ответ.', questions: [] });
  });

  it('не больше трёх вопросов', () => {
    const many = '```questions\n? a\n- 1\n? b\n- 1\n? c\n- 1\n? d\n- 1\n```';
    expect(extractQuestions(many).questions).toHaveLength(3);
  });

  it('displayText показывает вопросы списком вместо служебного блока', () => {
    const text = displayText(REPLY);
    expect(text).not.toContain('```');
    expect(text).toContain('**Чью сторону вы представляете?**\n- Поставщика');
  });
});

describe('plan helpers', () => {
  it('isPlanCommand — только команда в начале', () => {
    expect(isPlanCommand('/plan')).toBe(true);
    expect(isPlanCommand('/Plan Внесите изменения')).toBe(true);
    expect(isPlanCommand('мой /plan')).toBe(false);
    expect(isPlanCommand('/planning')).toBe(false);
  });

  it('looksLikePlan отличает план от просьбы описать дело', () => {
    expect(looksLikePlan('### Цель\nx\n### План действий\n1. y')).toBe(true);
    expect(looksLikePlan('Опишите ситуацию или приложите договор.')).toBe(false);
  });

  it('answersMessage собирает ответы', () => {
    expect(answersMessage('Ответы:', [{ question: 'Сторона?', answer: 'Поставщик' }])).toBe('Ответы:\n1. Сторона? — Поставщик');
  });
});
