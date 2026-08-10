/**
 * Тесты гейта «сайт по ссылке». Логика — модульно, а сам сервер поднимается
 * настоящим процессом на настоящем порту: ошибка «закрытый сайт всё равно
 * отдаёт файлы» видна только в живом ответе, а не в юнит-проверке.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COOKIE_NAME,
  buildSetCookie,
  cacheControlFor,
  isTokenValid,
  matchCode,
  parseCodes,
  parseCookieHeader,
  pickEncoding,
  staticCandidates,
  suppliedCode,
  tokenForCode,
} from './site-gate.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

describe('коды доступа', () => {
  it('разбирает список, чистит пробелы и повторы', () => {
    expect(parseCodes(' invest-2026 , grant ,, invest-2026 ')).toEqual(['invest-2026', 'grant']);
    expect(parseCodes('')).toEqual([]);
    expect(parseCodes(undefined)).toEqual([]);
  });

  it('кука подходит только к живому коду, а отозванный перестаёт пускать', () => {
    const codes = ['invest-2026', 'grant-2026'];
    const token = tokenForCode('invest-2026', 's');
    expect(isTokenValid(token, codes, 's')).toBe(true);
    // Убрали код из списка — выданные по нему куки мертвы без всякой чистки.
    expect(isTokenValid(token, ['grant-2026'], 's')).toBe(false);
    // Смена соли разлогинивает всех.
    expect(isTokenValid(token, codes, 'другая-соль')).toBe(false);
  });

  it('в куке лежит не сам код', () => {
    expect(tokenForCode('invest-2026', 's')).not.toContain('invest-2026');
  });

  it('мусор вместо куки не пускает', () => {
    const codes = ['invest-2026'];
    for (const bad of ['', 'x', undefined, null, 'a'.repeat(64)]) {
      expect(isTokenValid(bad, codes, 's')).toBe(false);
    }
  });

  it('код берётся из ?k= или ?invite=, чужой не подходит', () => {
    const codes = ['invest-2026'];
    expect(matchCode(suppliedCode(new URLSearchParams('k=invest-2026')), codes)).toBe('invest-2026');
    expect(matchCode(suppliedCode(new URLSearchParams('invite=invest-2026')), codes)).toBe('invest-2026');
    expect(matchCode(suppliedCode(new URLSearchParams('k=INVEST-2026')), codes)).toBe(null);
    expect(matchCode(suppliedCode(new URLSearchParams('')), codes)).toBe(null);
  });

  it('кука закрыта от JS и переживает переход по ссылке из мессенджера', () => {
    const cookie = buildSetCookie('abc', { secure: true });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=2592000');
    expect(buildSetCookie('abc', { secure: false })).not.toContain('Secure');
  });

  it('разбирает Cookie рядом с чужими куками', () => {
    const parsed = parseCookieHeader(`_ga=1; ${COOKIE_NAME}=tok3n; other=2`);
    expect(parsed[COOKIE_NAME]).toBe('tok3n');
  });
});

describe('какой файл отдать', () => {
  it('корень и предрендеренные разделы', () => {
    expect(staticCandidates('/')).toEqual(['index.html']);
    expect(staticCandidates('/pricing')).toEqual(['pricing/index.html', 'index.html']);
    expect(staticCandidates('/pricing/')).toEqual(['pricing/index.html', 'index.html']);
  });

  it('адрес кабинета падает на index.html — маршрут разберёт приложение', () => {
    expect(staticCandidates('/projects')).toEqual(['projects/index.html', 'index.html']);
  });

  it('файл с расширением НЕ подменяется на index.html', () => {
    // Иначе браузер получит HTML вместо скрипта и страница сломается молча.
    expect(staticCandidates('/assets/index-abc123.js')).toEqual(['assets/index-abc123.js']);
    expect(staticCandidates('/robots.txt')).toEqual(['robots.txt']);
  });

  it('выход за пределы каталога сборки отбивается', () => {
    expect(staticCandidates('/../server/.env')).toBe(null);
    expect(staticCandidates('/assets/../../.env')).toBe(null);
    expect(staticCandidates('/%2e%2e/%2e%2e/.env')).toBe(null);
    expect(staticCandidates('/..\\.env')).toBe(null);
    expect(staticCandidates('/%ZZ')).toBe(null);
  });
});

describe('кэш и сжатие', () => {
  it('файлы с хешем — навсегда, HTML — никогда', () => {
    expect(cacheControlFor('assets/index-BCe1ivXg.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('index.html')).toBe('no-cache');
    expect(cacheControlFor('pricing/index.html')).toBe('no-cache');
  });

  it('предсжатие отдаётся только тому, кто его понимает', () => {
    const both = { br: true, gzip: true };
    expect(pickEncoding('gzip, deflate, br', both).encoding).toBe('br');
    expect(pickEncoding('gzip, deflate', both).encoding).toBe('gzip');
    expect(pickEncoding('', both).encoding).toBe(null);
    expect(pickEncoding('gzip, br', { br: false, gzip: true }).encoding).toBe('gzip');
  });
});

describe('живой сервер', () => {
  const PORT = 43117;
  const BASE = `http://127.0.0.1:${PORT}`;
  let dist;
  let child;

  beforeAll(async () => {
    dist = await fs.mkdtemp(path.join(os.tmpdir(), 'lexab-dist-'));
    await fs.writeFile(path.join(dist, 'index.html'), '<html>ГЛАВНАЯ</html>');
    await fs.mkdir(path.join(dist, 'pricing'));
    await fs.writeFile(path.join(dist, 'pricing/index.html'), '<html>ТАРИФЫ</html>');
    await fs.writeFile(path.join(dist, 'secret.txt'), 'файл внутри сборки');

    child = spawn(process.execPath, [path.join(SCRIPTS, 'serve-static.mjs')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        SITE_DIST_DIR: dist,
        SITE_ACCESS_CODES: 'invest-2026, grant-2026',
        SITE_GATE_SECRET: 'тест',
      },
      stdio: 'ignore',
    });

    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`${BASE}/healthz`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error('сервер не поднялся');
  }, 20_000);

  afterAll(async () => {
    child?.kill();
    if (dist) await fs.rm(dist, { recursive: true, force: true });
  });

  it('без приглашения отдаёт заглушку, а не сайт', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    const body = await res.text();
    expect(body).toContain('по приглашению');
    expect(body).not.toContain('ГЛАВНАЯ');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('закрытым остаётся и раздел, и файл внутри сборки', async () => {
    expect(await (await fetch(`${BASE}/pricing`)).text()).not.toContain('ТАРИФЫ');
    expect(await (await fetch(`${BASE}/secret.txt`)).text()).not.toContain('файл внутри сборки');
  });

  it('поисковикам говорит «нельзя» вместо обычного robots.txt', async () => {
    expect(await (await fetch(`${BASE}/robots.txt`)).text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('ссылка с кодом ставит куку и убирает код из адреса', async () => {
    const res = await fetch(`${BASE}/pricing?k=invest-2026`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/pricing');
    expect(res.headers.get('set-cookie')).toContain(`${COOKIE_NAME}=`);
  });

  it('за прокси кука Secure, без прокси — нет (иначе браузер её выбросит)', async () => {
    const behindProxy = await fetch(`${BASE}/?k=invest-2026`, {
      headers: { 'x-forwarded-proto': 'https' },
      redirect: 'manual',
    });
    expect(behindProxy.headers.get('set-cookie')).toContain('Secure');
    const plain = await fetch(`${BASE}/?k=invest-2026`, { redirect: 'manual' });
    expect(plain.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('с кукой сайт работает как обычно', async () => {
    const cookie = `${COOKIE_NAME}=${tokenForCode('grant-2026', 'тест')}`;
    expect(await (await fetch(`${BASE}/`, { headers: { cookie } })).text()).toContain('ГЛАВНАЯ');
    expect(await (await fetch(`${BASE}/pricing`, { headers: { cookie } })).text()).toContain('ТАРИФЫ');
    // Несуществующий маршрут кабинета отдаёт приложение, а не 404.
    expect(await (await fetch(`${BASE}/projects`, { headers: { cookie } })).text()).toContain('ГЛАВНАЯ');
  });

  it('подделанная кука не пускает', async () => {
    const res = await fetch(`${BASE}/`, { headers: { cookie: `${COOKIE_NAME}=${'0'.repeat(64)}` } });
    expect(await res.text()).toContain('по приглашению');
  });

  it('проверка живости работает и при закрытом сайте', async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('не отдаёт файлы за пределами сборки', async () => {
    const cookie = `${COOKIE_NAME}=${tokenForCode('grant-2026', 'тест')}`;
    const res = await fetch(`${BASE}/../../package.json`, { headers: { cookie }, redirect: 'manual' });
    expect(res.status).not.toBe(200);
  });
});
