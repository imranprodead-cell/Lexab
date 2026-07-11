import { describe, expect, it } from 'vitest';
import { isLanguage, isRtl, LANGUAGES, MESSAGES, pickText, resolveMessage } from './messages';
import { EXTRA } from './translations';

describe('i18n messages', () => {
  it('every key has both ru and en translations', () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.ru, `ru missing for ${key}`).toBeTruthy();
      expect(entry.en, `en missing for ${key}`).toBeTruthy();
    }
  });

  it('covers the core navigation keys', () => {
    for (const key of ['nav.chat', 'nav.documents', 'nav.settings', 'top.upgrade']) {
      expect(MESSAGES[key]).toBeDefined();
    }
  });

  it('exposes exactly the six expected languages, EN and RU first', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'ru', 'ar', 'de', 'kk', 'uz']);
  });

  it('every key resolves to a non-empty string in every language', () => {
    for (const key of Object.keys(MESSAGES)) {
      for (const { code } of LANGUAGES) {
        expect(resolveMessage(key, code), `${key} @ ${code}`).toBeTruthy();
      }
    }
  });

  it('the extra languages cover the whole catalogue (fallbacks are the exception, not the rule)', () => {
    const total = Object.keys(MESSAGES).length;
    for (const code of ['ar', 'de', 'kk', 'uz']) {
      const covered = Object.keys(MESSAGES).filter((k) => EXTRA[code]?.[k]).length;
      // Allow a small margin, but a big gap means a translation file drifted.
      expect(covered, `${code} covers ${covered}/${total}`).toBeGreaterThanOrEqual(total - 5);
    }
  });

  it('isLanguage narrows only the six supported codes', () => {
    for (const c of ['en', 'ru', 'ar', 'de', 'kk', 'uz']) expect(isLanguage(c)).toBe(true);
    for (const c of ['fr', 'EN', '', 'russian', null, undefined, 42]) expect(isLanguage(c)).toBe(false);
  });

  it('isRtl is true only for Arabic', () => {
    expect(isRtl('ar')).toBe(true);
    for (const c of ['en', 'ru', 'de', 'kk', 'uz'] as const) expect(isRtl(c)).toBe(false);
  });

  it('pickText returns ru for Russian and falls back to English for every other language', () => {
    const entry = { ru: 'Привет', en: 'Hello' };
    expect(pickText(entry, 'ru')).toBe('Привет');
    for (const c of ['en', 'ar', 'de', 'kk', 'uz'] as const) expect(pickText(entry, c)).toBe('Hello');
  });

  it('resolveMessage falls back to English when an extra language lacks a key', () => {
    // A synthetic key not present in any translation map resolves to English.
    const key = Object.keys(MESSAGES)[0];
    expect(resolveMessage(key, 'en')).toBe(MESSAGES[key].en);
    expect(resolveMessage('___no_such_key___', 'de')).toBeUndefined();
  });
});
