import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './userAgent';

// Строки — со скриншота «Активных сессий» владельца (2026-10-17) и типичные.
const CASES: [string, string | null][] = [
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15', 'Safari · macOS'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36', 'Chrome · Windows'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome · iPhone'],
  ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'Edge · Windows'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/25.8.0.0 Safari/537.36', 'Yandex Browser · Windows'],
  ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox · Linux'],
  ['curl/8.7.1', null],
  ['', null],
];

describe('describeUserAgent', () => {
  for (const [ua, label] of CASES) {
    it(`${label ?? 'неизвестно'} ← ${ua.slice(0, 40) || '(пусто)'}`, () => {
      expect(describeUserAgent(ua)).toBe(label);
    });
  }
});
