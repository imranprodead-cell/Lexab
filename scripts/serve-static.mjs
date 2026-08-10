#!/usr/bin/env node
/**
 * Раздача собранного сайта (dist/) на Railway + гейт «только по ссылке».
 *
 * Почему свой сервер, а не готовый `serve`/`vite preview`:
 *  1. Публичные разделы предрендерены в dist/<слаг>/index.html. Хостинг обязан
 *     отдавать их по адресу /<слаг>, иначе краулер и превью в мессенджере
 *     получат пустую SPA-заглушку, а сайт при этом БУДЕТ выглядеть рабочим —
 *     ровно так ведёт себя `vite preview` (см. HANDOFF.md).
 *  2. Сборка кладёт рядом .br/.gz — их нужно отдавать, иначе предсжатие,
 *     ради которого резали вес первой загрузки, не работает вовсе.
 *  3. Гейт по ссылке должен стоять ДО отдачи любого файла.
 *
 * Переменные окружения:
 *   PORT                — порт (Railway задаёт сам; локально 4173)
 *   SITE_ACCESS_CODES   — коды доступа через запятую. ПУСТО = сайт открыт всем.
 *                         Именно так он и открывается на публику: переменная
 *                         удаляется, код не трогаем.
 *   SITE_GATE_SECRET    — соль для куки. Смена = разлогинить всех приглашённых.
 *   SITE_DIST_DIR       — каталог сборки (по умолчанию ./dist)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COOKIE_NAME,
  buildSetCookie,
  cacheControlFor,
  contentTypeFor,
  isTokenValid,
  matchCode,
  parseCodes,
  parseCookieHeader,
  pickEncoding,
  staticCandidates,
  suppliedCode,
  tokenForCode,
} from './site-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.SITE_DIST_DIR ?? 'dist');
const PORT = Number(process.env.PORT ?? 4173);
const CODES = parseCodes(process.env.SITE_ACCESS_CODES);
const SECRET = process.env.SITE_GATE_SECRET ?? 'lexab-site-gate';
const GATED = CODES.length > 0;

/**
 * Secure-кука по http не ставится вовсе, поэтому признак берём из самого
 * запроса, а не из настроек: на Railway прокси проставляет x-forwarded-proto,
 * локально его нет. Угадывать по порту или NODE_ENV — значит однажды выдать
 * гостю куку, которую его браузер молча выбросит.
 */
function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  return proto === 'https';
}

const STUB = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Lexab</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #fbfbfd; color: #1d1d1f; padding: 24px;
  }
  main { max-width: 30rem; text-align: center; }
  h1 { font-size: 1.6rem; letter-spacing: -0.02em; margin: 0 0 0.75rem; }
  p { margin: 0 0 0.5rem; color: #6e6e73; }
  .en { font-size: 0.95rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #000; color: #f5f5f7; }
    p { color: #98989d; }
  }
</style>
</head><body><main>
  <h1>Lexab</h1>
  <p>Сайт пока закрыт — доступ по приглашению.</p>
  <p class="en">This site is not public yet — access is by invitation.</p>
</main></body></html>
`;

const ROBOTS_CLOSED = 'User-agent: *\nDisallow: /\n';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

/** Пока сайт закрыт, ни одна страница не должна попасть в индекс поисковика. */
function noindexHeaders() {
  return GATED ? { 'X-Robots-Tag': 'noindex, nofollow' } : {};
}

async function statFile(filePath) {
  try {
    const st = await fsp.stat(filePath);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

async function serveFile(req, res, relPath) {
  const filePath = path.join(DIST, relPath);
  // Второй рубеж против выхода из каталога: staticCandidates уже отсекает '..',
  // но проверка по итоговому пути переживёт любую будущую правку разбора.
  if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) return false;

  const stat = await statFile(filePath);
  if (!stat) return false;

  const available = {
    br: Boolean(await statFile(`${filePath}.br`)),
    gzip: Boolean(await statFile(`${filePath}.gz`)),
  };
  const { encoding, suffix } = pickEncoding(req.headers['accept-encoding'], available);
  const servedPath = `${filePath}${suffix}`;
  const servedStat = encoding ? await statFile(servedPath) : stat;

  const headers = {
    'Content-Type': contentTypeFor(relPath),
    'Content-Length': String(servedStat.size),
    'Cache-Control': cacheControlFor(relPath),
    Vary: 'Accept-Encoding',
    ...noindexHeaders(),
  };
  if (encoding) headers['Content-Encoding'] = encoding;

  res.writeHead(200, { 'X-Content-Type-Options': 'nosniff', ...headers });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(servedPath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    }

    const url = new URL(req.url, 'http://localhost');

    // Проверка живости для Railway — мимо гейта, иначе платформа сочтёт
    // закрытый сайт упавшим и будет бесконечно перезапускать контейнер.
    if (url.pathname === '/healthz') {
      return send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (GATED) {
      const code = matchCode(suppliedCode(url.searchParams), CODES);
      if (code) {
        // Код из адресной строки убираем сразу же: иначе он останется в
        // истории браузера, в реферере и в скриншотах демонстрации.
        url.searchParams.delete('k');
        url.searchParams.delete('invite');
        const clean = url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '');
        return send(res, 302, '', {
          Location: clean,
          'Set-Cookie': buildSetCookie(tokenForCode(code, SECRET), { secure: isHttps(req) }),
          'Cache-Control': 'no-store',
          ...noindexHeaders(),
        });
      }

      const cookies = parseCookieHeader(req.headers.cookie);
      if (!isTokenValid(cookies[COOKIE_NAME], CODES, SECRET)) {
        if (url.pathname === '/robots.txt') {
          return send(res, 200, ROBOTS_CLOSED, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
        }
        return send(res, 200, STUB, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        });
      }
    }

    const candidates = staticCandidates(url.pathname);
    if (!candidates) return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    for (const rel of candidates) {
      if (await serveFile(req, res, rel)) return;
    }
    send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8', ...noindexHeaders() });
  } catch (err) {
    console.error('[serve-static]', err);
    if (!res.headersSent) send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    else res.end();
  }
});

if (!fs.existsSync(DIST)) {
  console.error(`[serve-static] нет каталога сборки ${DIST} — сначала npm run build`);
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[serve-static] ${DIST} → http://0.0.0.0:${PORT} — ` +
      (GATED ? `доступ по ссылке, кодов: ${CODES.length}` : 'ОТКРЫТ ВСЕМ (SITE_ACCESS_CODES пуст)'),
  );
});

// Railway останавливает контейнер сигналом: закрываем приём соединений, чтобы
// деплой не рвал ответ на полуслове.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
