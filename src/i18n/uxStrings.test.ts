import { beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES, MESSAGES, registerExtraLanguage, resolveMessage, type Language } from './messages';
import { EXTRA } from './translations';
import { UX_MESSAGES } from './uxStrings';
import './uxMessages';

beforeAll(() => {
  for (const [code, dict] of Object.entries(EXTRA)) registerExtraLanguage(code as Language, dict);
});

describe('ux strings (вне главного чанка)', () => {
  it('every ux key has ru and en', () => {
    for (const [key, entry] of Object.entries(UX_MESSAGES)) {
      expect(key.startsWith('ux.'), key).toBe(true);
      expect(entry.ru, `ru missing for ${key}`).toBeTruthy();
      expect(entry.en, `en missing for ${key}`).toBeTruthy();
    }
  });

  it('every ux key is translated in all four extra languages', () => {
    for (const key of Object.keys(UX_MESSAGES)) {
      for (const code of ['ar', 'de', 'kk', 'uz']) {
        expect(EXTRA[code]?.[key], `${key} @ ${code}`).toBeTruthy();
      }
    }
  });

  it('loading the hook module registers the strings, so t() resolves them in every language', () => {
    for (const key of Object.keys(UX_MESSAGES)) {
      expect(MESSAGES[key]).toBe(UX_MESSAGES[key]);
      for (const { code } of LANGUAGES) expect(resolveMessage(key, code), `${key} @ ${code}`).toBeTruthy();
    }
  });
});
