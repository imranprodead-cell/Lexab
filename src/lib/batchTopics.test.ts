import { describe, expect, it } from 'vitest';
import { groupByTopic, topicOf, worstOf } from './batchTopics';

const f = (title: string, citation = '') => ({ title, citation });

describe('topicOf', () => {
  it('sorts typical Uzbek-contract findings into the right column', () => {
    expect(topicOf(f('Пеня 1% в день за просрочку поставки, без верхнего предела'))).toBe('penalty');
    expect(topicOf(f('Отказаться от договора может только Покупатель'))).toBe('termination');
    expect(topicOf(f('Односторонний отказ от исполнения договора только у Покупателя'))).toBe('termination');
    expect(topicOf(f('Споры рассматривает суд по месту Покупателя'))).toBe('disputes');
    expect(topicOf(f('Оплата через 60 банковских дней после поставки'))).toBe('payment');
    expect(topicOf(f('Нет срока приёмки товара по качеству'))).toBe('acceptance');
  });

  it('first matching rule wins: court reducing a penalty is a penalty finding', () => {
    expect(topicOf(f('Суд может уменьшить неустойку', 'ст. 326 ГК'))).toBe('penalty');
    expect(topicOf(f('Расторжение договора по решению суда'))).toBe('termination');
  });

  it('Cyrillic word edges work without \\b (пени vs пенсии)', () => {
    expect(topicOf(f('Размер пени не ограничен'))).toBe('penalty');
    expect(topicOf(f('Взносы в пенсионный фонд'))).toBe('other');
  });

  it('English and Uzbek titles are recognised too', () => {
    expect(topicOf(f('Governing jurisdiction favours the buyer'))).toBe('disputes');
    expect(topicOf(f("To'lov muddati 90 kun"))).toBe('payment');
  });
});

describe('groupByTopic / worstOf', () => {
  it('groups findings and picks the most severe verified one', () => {
    const items = [
      { ...f('Неустойка 2% в день'), severity: 'Medium' as const, unverified: false },
      { ...f('Штраф без предела'), severity: 'High' as const, unverified: false },
      { ...f('Оплата 90 дней'), severity: 'Low' as const, unverified: true },
    ];
    const g = groupByTopic(items);
    expect(g.penalty).toHaveLength(2);
    expect(worstOf(g.penalty)).toBe('High');
    expect(worstOf(g.payment)).toBe('check');
    expect(worstOf(g.disputes)).toBeNull();
  });
});
