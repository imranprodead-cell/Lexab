import { describe, expect, it } from 'vitest';
import { contractParagraphs, findRenewalClause, noticeSpan } from './renewalClause';

const P = [
  '1. Предмет договора. Арендодатель передаёт помещение площадью 120 кв. м.',
  '9.3. Если ни одна из Сторон не менее чем за 30 (тридцать) календарных дней до окончания срока действия Договора не заявит письменно о его прекращении, Договор считается продлённым на тот же срок.',
  '9.4. Договор может быть продлён по соглашению Сторон.',
  '10. Споры рассматриваются в экономическом суде.',
];

describe('findRenewalClause', () => {
  it('picks the renewal sentence that names the notice period', () => {
    expect(findRenewalClause(P, 30)).toBe(P[1]);
  });

  it('does not guess when the notice number is absent from every renewal sentence', () => {
    expect(findRenewalClause(P, 45)).toBeNull();
  });

  it('without a known notice period takes the renewal sentence that talks about notice', () => {
    expect(findRenewalClause(P, null)).toBe(P[1]);
  });

  it('returns null when nothing is about renewal', () => {
    expect(findRenewalClause([P[0], P[3]], 30)).toBeNull();
  });
});

describe('noticeSpan', () => {
  it('highlights the number with its words and unit', () => {
    const [a, b] = noticeSpan(P[1], 30)!;
    expect(P[1].slice(a, b)).toBe('30 (тридцать) календарных дней');
  });
  it('returns null without a period', () => {
    expect(noticeSpan(P[1], null)).toBeNull();
  });
});

describe('contractParagraphs', () => {
  it('uses the original wording at redline slots', () => {
    const paras = contractParagraphs({
      document: [{ type: 'paragraph', segments: ['9.3. Договор продлевается, если за ', { redlineId: 'r1' }, ' никто не возразит.'] }],
      redlines: [{ id: 'r1', delText: '30 дней', insText: '60 дней', severity: 'Low', status: 'pending' }],
    });
    expect(paras).toEqual(['9.3. Договор продлевается, если за 30 дней никто не возразит.']);
  });
});
