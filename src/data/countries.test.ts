import { describe, expect, it } from 'vitest';
import { COUNTRIES, flagUrl } from './countries';

describe('countries', () => {
  it('exposes the seven jurisdictions', () => {
    expect(COUNTRIES).toHaveLength(7);
    expect(COUNTRIES.map((c) => c.code)).toContain('GB');
  });

  it('builds lowercase flag URLs', () => {
    expect(flagUrl('GB')).toBe('https://flagcdn.com/w160/gb.png');
  });
});
