import { describe, expect, it } from 'vitest';
import { niceTicks, parseVisual, stripVisualMarkers, visualsToText } from './visuals';

const fence = (lang: string, data: unknown) => `\`\`\`${lang}\n${JSON.stringify(data)}\n\`\`\``;

describe('visual blocks from the AI answer', () => {
  it('valid blocks parse; broken or foreign ones are dropped (never shown raw)', () => {
    expect(parseVisual('lexab-steps', JSON.stringify({ steps: [{ title: 'Претензия', date: '2026-11-25' }, { title: 'Иск' }] }))?.kind).toBe('steps');
    expect(parseVisual('lexab-steps', '{"steps":[{"detail":"нет заголовка"}]}')).toBeNull();
    expect(parseVisual('lexab-timeline', '{"events":[{"label":"x","date":"25.11.2026"}]}')).toBeNull();
    expect(parseVisual('lexab-chart', '{"title":"t","kind":"bar","labels":["a","b"],"series":[{"values":[1]}]}')).toBeNull();
    expect(parseVisual('lexab-chart', '{"title":"t","kind":"pie","labels":["a"],"series":[{"values":[1]}]}')).toBeNull();
    expect(parseVisual('lexab-law', '{"unitId":"lu_x","label":"ст. 356 ГК"}')?.kind).toBe('law');
    expect(parseVisual('lexab-law', 'not json')).toBeNull();
    expect(parseVisual('lexab-edit', '{}')).toBeNull();
  });

  it('markers are hidden while the answer streams', () => {
    expect(stripVisualMarkers('Сроки:\n[[lexab:1]]\nДальше')).toBe('Сроки:\n\nДальше');
  });

  it('copy / read aloud: blocks become plain text, broken blocks vanish', () => {
    const text = [
      'Вот план.',
      fence('lexab-steps', { title: 'Взыскание', steps: [{ title: 'Претензия', date: '2026-11-25', who: 'вы' }, { title: 'Иск', docs: ['Договор'] }] }),
      fence('lexab-timeline', { events: [{ label: 'Оплата', date: '2026-12-01' }] }),
      fence('lexab-chart', { title: 'Пеня', kind: 'bar', unit: 'сум', labels: ['30 дн.'], series: [{ name: '', values: [36000000] }] }),
      fence('lexab-law', { unitId: 'lu_x', label: 'ст. 356 ГК', note: 'цена по соглашению' }),
      '```lexab-chart\n{broken\n```',
    ].join('\n\n');
    const out = visualsToText(text);
    expect(out).toContain('1. Претензия (25.11.2026; вы)');
    expect(out).toContain('2. Иск. Договор');
    expect(out).toContain('01.12.2026 — Оплата');
    expect(out).toContain('30 дн.: 36000000 сум');
    expect(out).toContain('ст. 356 ГК — цена по соглашению');
    expect(out).not.toContain('```');
    expect(out).not.toContain('{');
  });

  it('axis ticks are round and include zero', () => {
    expect(niceTicks(0, 72000000)).toEqual([0, 20000000, 40000000, 60000000, 80000000]);
    expect(niceTicks(-5, 12)).toEqual([-5, 0, 5, 10, 15]);
    expect(niceTicks(3, 3)[0]).toBe(0);
  });
});
