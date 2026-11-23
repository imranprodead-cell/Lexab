/**
 * Тесты гейта «сайт по ссылке». Логика — модульно, а сам сервер поднимается
 * настоящим процессом на настоящем порту: ошибка «закрытый сайт всё равно
 * отдаёт файлы» видна только в живом ответе, а не в юнит-проверке.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COOKIE_NAME,
  appRouteMatcher,
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

describe('адрес приложения или мусор (для кода 404)', () => {
  const isAppRoute = appRouteMatcher(['/', '/pricing', '/team-access'], ['/chat', '/team', '/share/']);

  it('публичные страницы и корень — адреса приложения', () => {
    expect(isAppRoute('/')).toBe(true);
    expect(isAppRoute('/pricing')).toBe(true);
    expect(isAppRoute('/pricing/')).toBe(true);
    expect(isAppRoute('/team-access')).toBe(true);
  });

  it('раздел кабинета — сам и всё под ним, но не похожие слова', () => {
    expect(isAppRoute('/chat')).toBe(true);
    expect(isAppRoute('/chat/abc/workspace')).toBe(true);
    expect(isAppRoute('/chatty')).toBe(false);
    expect(isAppRoute('/teams')).toBe(false);
  });

  it('префикс со слешем — только адреса под ним', () => {
    expect(isAppRoute('/share/tok123')).toBe(true);
    expect(isAppRoute('/share')).toBe(false);
    expect(isAppRoute('/share/')).toBe(false);
  });

  it('неизвестный адрес — не приложение', () => {
    expect(isAppRoute('/wp-login.php-like')).toBe(false);
    expect(isAppRoute('/pricing/old')).toBe(false);
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

describe('открытый сайт: коды ответа для поисковиков', () => {
  const PORT = 43118;
  const BASE = `http://127.0.0.1:${PORT}`;
  let dist;
  let child;

  beforeAll(async () => {
    dist = await fs.mkdtemp(path.join(os.tmpdir(), 'lexab-dist-open-'));
    await fs.writeFile(path.join(dist, 'index.html'), '<html>ОБОЛОЧКА</html>');
    await fs.mkdir(path.join(dist, 'pricing'));
    await fs.writeFile(path.join(dist, 'pricing/index.html'), '<html>ТАРИФЫ</html>');
    await fs.writeFile(
      path.join(dist, 'sitemap.xml'),
      '<urlset><url><loc>https://example.test/</loc></url><url><loc>https://example.test/pricing</loc></url></urlset>',
    );

    // Без SITE_ACCESS_CODES — сайт открыт всем; INDEXNOW_PING не задан —
    // тест не должен ничего отправлять наружу.
    const { SITE_ACCESS_CODES: _codes, INDEXNOW_PING: _ping, ...env } = process.env;
    child = spawn(process.execPath, [path.join(SCRIPTS, 'serve-static.mjs')], {
      env: { ...env, PORT: String(PORT), SITE_DIST_DIR: dist },
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

  it('снимок раздела — 200 со своим текстом', async () => {
    const res = await fetch(`${BASE}/pricing`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ТАРИФЫ');
  });

  it('раздел кабинета — 200 и оболочка приложения', async () => {
    const res = await fetch(`${BASE}/chat/abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ОБОЛОЧКА');
  });

  it('неизвестный адрес — 404, но с оболочкой: приложение нарисует «не найдено»', async () => {
    const res = await fetch(`${BASE}/no-such-page-xyz`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('ОБОЛОЧКА');
  });

  // fetch молча выбрасывает заголовок Host (запрещённый заголовок по стандарту
  // Fetch) — поэтому здесь обычный http.get, иначе тест проверял бы не то.
  const getWithHost = (urlPath, host) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: PORT, path: urlPath, headers: { host } }, (res) => {
          res.resume();
          resolve({ status: res.statusCode, location: res.headers.location });
        })
        .on('error', reject);
    });

  it('www своего домена — 301 на основной с тем же путём', async () => {
    const res = await getWithHost('/pricing?x=1', 'www.example.test');
    expect(res.status).toBe(301);
    expect(res.location).toBe('https://example.test/pricing?x=1');
  });

  it('IndexNow: после старта отправляет адреса из sitemap с ключом из реестра', async () => {
    // Подставной приёмник вместо api.indexnow.org — наружу тест ничего не шлёт.
    const received = new Promise((resolve) => {
      const sink = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.writeHead(200).end();
          sink.close();
          resolve({ method: req.method, body: JSON.parse(body) });
        });
      });
      sink.listen(43119);
    });
    const pinger = spawn(process.execPath, [path.join(SCRIPTS, 'serve-static.mjs')], {
      env: {
        ...process.env,
        SITE_ACCESS_CODES: '',
        PORT: '43120',
        SITE_DIST_DIR: dist,
        INDEXNOW_PING: '1',
        INDEXNOW_DELAY_MS: '50',
        INDEXNOW_ENDPOINT: 'http://127.0.0.1:43119/indexnow',
      },
      stdio: 'ignore',
    });
    try {
      const { method, body } = await received;
      const registry = JSON.parse(await fs.readFile(path.join(SCRIPTS, '../src/content/site/routes.json'), 'utf8'));
      expect(method).toBe('POST');
      expect(body.host).toBe('example.test');
      expect(body.key).toBe(registry.indexNowKey);
      expect(body.keyLocation).toBe(`https://example.test/${registry.indexNowKey}.txt`);
      expect(body.urlList).toEqual(['https://example.test/', 'https://example.test/pricing']);
    } finally {
      pinger.kill();
    }
  }, 10_000);

  it('чужой Host не перенаправляется (нет открытого редиректа)', async () => {
    const res = await getWithHost('/pricing', 'www.evil.test');
    expect(res.status).toBe(200);
    expect(res.location).toBeUndefined();
  });
});
