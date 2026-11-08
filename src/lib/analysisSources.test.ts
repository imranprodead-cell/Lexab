import { describe, expect, it } from 'vitest';
import type { Finding } from '@/types/domain';
import { analysisSources, citationKey } from './analysisSources';

const f = (p: Partial<Finding>): Finding => ({ id: 'x', severity: 'High', title: 't', citation: '', ...p });

describe('analysis sources', () => {
  it('numbers provisions by first mention and merges repeats', () => {
    const list = analysisSources([
      f({ citation: 'ст. 706 ГК', unitId: 'u706' }),
      f({ citation: 'ст.  326 ГК', unitId: 'u326' }),
      f({ citation: 'Ст. 706 ГК', unitId: 'u706' }),
      f({ citation: '' }),
    ]);
    expect(list.map((s) => [s.n, s.citation, s.state])).toEqual([
      [1, 'ст. 706 ГК', 'verified'],
      [2, 'ст. 326 ГК', 'verified'],
    ]);
    expect(citationKey('Ст.  706 ГК')).toBe(list[0].key);
  });

  it('keeps an unconfirmed citation apart and upgrades it once any finding confirms it', () => {
    const only = analysisSources([f({ citation: 'ст. 44 Конституции', unverified: true })]);
    expect(only[0]).toMatchObject({ state: 'unverified', unitId: null });
    const upgraded = analysisSources([
      f({ citation: 'ст. 9 ГК', unverified: true }),
      f({ citation: 'ст. 9 ГК', unitId: 'u9' }),
    ]);
    expect(upgraded).toEqual([{ n: 1, key: 'ст. 9 гк', citation: 'ст. 9 ГК', unitId: 'u9', state: 'verified' }]);
  });

  it('marks old analyses without verification data as neither', () => {
    expect(analysisSources([f({ citation: 's.14 SGA 1979' })])[0].state).toBe('none');
  });
});
