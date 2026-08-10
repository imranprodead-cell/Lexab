/**
 * Гейт «сайт открывается только по ссылке» — чистая логика, без сервера.
 *
 * Зачем отдельным файлом: в serve-static.mjs живёт возня с сокетами и файлами,
 * которую тестировать дорого, а решения «пускать/не пускать» и «какой файл
 * отдать» должны проверяться тестами построчно — ошибка здесь либо открывает
 * закрытый сайт, либо ломает его для приглашённых.
 *
 * Модель доступа: у нас нет пользователей и паролей на этом уровне. Есть список
 * кодов (SITE_ACCESS_CODES) — по одному на аудиторию: инвесторы, жюри гранта.
 * Ссылка вида https://lexabai.com/?k=КОД ставит куку и уводит на чистый адрес,
 * дальше человек ходит по сайту как обычно. Отзыв доступа = удаление кода из
 * списка: куки, выданные по нему, перестают подходить сами.
 */
import crypto from 'node:crypto';

/** Имя куки. Меняется вместе с форматом токена — иначе старая кука не пройдёт. */
export const COOKIE_NAME = 'lexab_pass';

/** Сколько кука живёт. Месяц: демонстрация инвестору не должна прерываться. */
export const COOKIE_MAX_AGE_DAYS = 30;

/**
 * В куке лежит НЕ сам код, а его HMAC. Так код не утекает из браузера гостя
 * (расширения, скриншоты devtools, общий компьютер на конкурсе) и его нельзя
 * переслать дальше простым копированием значения куки.
 */
export function tokenForCode(code, secret) {
  return crypto.createHmac('sha256', secret).update(code).digest('hex');
}

/** `SITE_ACCESS_CODES=a, b ,,c` → ['a','b','c']. Пусто = гейта нет. */
export function parseCodes(raw) {
  return [...new Set(String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * Сравнение постоянного времени: обычное === на строках выходит раньше на
 * первом несовпавшем символе, и по времени ответа токен можно подобрать
 * посимвольно. Здесь перебираются ВСЕ коды без раннего выхода.
 */
export function isTokenValid(token, codes, secret) {
  if (typeof token !== 'string' || token.length === 0) return false;
  const supplied = Buffer.from(token);
  let ok = false;
  for (const code of codes) {
    const expected = Buffer.from(tokenForCode(code, secret));
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) ok = true;
  }
  return ok;
}

/** Код из ссылки. `k` — короткий основной, `invite` — читаемый синоним. */
export function suppliedCode(searchParams) {
  return searchParams.get('k') ?? searchParams.get('invite') ?? null;
}

/** Тот же код постоянного времени, но для сырого кода из ссылки. */
export function matchCode(supplied, codes) {
  if (typeof supplied !== 'string' || supplied.length === 0) return null;
  const given = Buffer.from(supplied);
  let matched = null;
  for (const code of codes) {
    const expected = Buffer.from(code);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) matched = code;
  }
  return matched;
}

/** Разбор заголовка Cookie. Чужие куки нам не мешают — берём только свою. */
export function parseCookieHeader(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * HttpOnly — чтобы кука не читалась из JS (в том числе чужим скриптом на
 * странице). SameSite=Lax — ссылка из письма или мессенджера обязана работать
 * с первого клика, а Strict именно этот сценарий и ломает.
 */
export function buildSetCookie(token, { secure = true, maxAgeDays = COOKIE_MAX_AGE_DAYS } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${Math.round(maxAgeDays * 24 * 60 * 60)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Какой файл отдать по адресу из браузера.
 *
 * Сборка кладёт разделы сайта в dist/<слаг>/index.html (предрендер для
 * поисковиков), а адреса кабинета вроде /projects в dist не существуют вовсе —
 * их рисует уже загруженное приложение. Отсюда два разных правила:
 *
 *  • адрес С расширением (.js, .css, .png) — это конкретный файл. Не нашли —
 *    404. Подсовывать вместо него index.html нельзя: браузер получит HTML
 *    вместо скрипта и страница сломается молча;
 *  • адрес БЕЗ расширения — сначала пробуем предрендеренную страницу, а если
 *    её нет, отдаём index.html: приложение разберётся с маршрутом само.
 *
 * Возвращает null, если адрес пытается вылезти за пределы каталога сборки.
 */
export function staticCandidates(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // битая %-последовательность
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const trimmed = decoded.replace(/^\/+/, '');
  const segments = [];
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null; // выход вверх — сразу отказ, без нормализации
    segments.push(segment);
  }
  const rel = segments.join('/');
  if (rel === '') return ['index.html'];

  const last = segments[segments.length - 1];
  if (last.includes('.')) return [rel];
  return [`${rel}/index.html`, 'index.html'];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(filePath) {
  const dot = filePath.lastIndexOf('.');
  return (dot === -1 ? null : MIME[filePath.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

/**
 * Файлы с хешем в имени (index-BCe1ivXg.js) кладём в кэш навсегда: имя меняется
 * при каждой сборке. HTML — никогда: иначе гость увидит вчерашнюю страницу.
 */
export function cacheControlFor(filePath) {
  if (filePath.endsWith('.html')) return 'no-cache';
  if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(filePath)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

/** Лучшее из предсжатых представлений, которое понимает браузер. */
export function pickEncoding(acceptEncoding, available) {
  const accepted = String(acceptEncoding ?? '').toLowerCase();
  if (available.br && accepted.includes('br')) return { encoding: 'br', suffix: '.br' };
  if (available.gzip && accepted.includes('gzip')) return { encoding: 'gzip', suffix: '.gz' };
  return { encoding: null, suffix: '' };
}
