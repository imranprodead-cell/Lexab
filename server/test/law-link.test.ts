/**
 * «Открыть на официальном сайте» у нормы из разбора: точный адрес статьи,
 * а не начало всего кодекса (жалоба владельца 2026-10-31).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { officialLink } from '../src/routes/law.routes.ts';

describe('official link of a provision', () => {
  it('prefers the exact article address over the whole act', () => {
    assert.equal(officialLink('https://lex.uz/ru/docs/180550#187114', 'https://lex.uz/ru/docs/180550'), 'https://lex.uz/ru/docs/180550#187114');
  });
  it('falls back to the act address and upgrades http to https', () => {
    assert.equal(officialLink(null, 'http://www.legislation.gov.uk/ukpga/1979/54'), 'https://www.legislation.gov.uk/ukpga/1979/54');
    assert.equal(officialLink('', 'https://adilet.zan.kz/rus/docs/K990000409_'), 'https://adilet.zan.kz/rus/docs/K990000409_');
  });
  it('never returns a non-web or broken address', () => {
    assert.equal(officialLink('javascript:alert(1)', 'not a url'), null);
    assert.equal(officialLink(null, null), null);
  });
});
