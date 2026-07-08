import { describe, expect, it } from 'vitest';
import { MESSAGES } from './messages';

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
});
