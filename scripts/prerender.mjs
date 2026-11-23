/**
 * Build-time prerender of the PUBLIC routes so non-JS crawlers see real body
 * text (the SPA otherwise ships an empty <div id="root">). Runs after
 * `vite build` as a postbuild step.
 *
 * CSP-safe by construction: the built index.html carries a Content-Security-
 * Policy <meta> with sha256 hashes of every inline script/handler. This script
 * ONLY replaces the empty #root with the rendered snapshot and rewrites the
 * text of <title> / meta description / canonical / og:url — it never touches a
 * <script> or on*-handler, so the hashes stay valid.
 *
 * Список страниц — в src/content/site/routes.json (один источник для снимков,
 * sitemap.xml и robots.txt). Домен — из VITE_SITE_ORIGIN. Оба SEO-файла
 * пишутся ДО проверки puppeteer: снимки страниц — улучшение, а карта сайта и
 * robots нужны всегда.
 *
 * СНИМКИ ОБЯЗАТЕЛЬНЫ: нет puppeteer или браузера — сборка ПАДАЕТ.
 * Раньше здесь был «мягкий пропуск» (exit 0), и на Railway, где браузер не
 * скачивался (PUPPETEER_SKIP_DOWNLOAD), сайт с августа по ноябрь 2026 жил без
 * единого снимка: ChatGPT, Claude, Perplexity и поисковики видели на любом
 * адресе пустой <div id="root"> и заголовок главной. Сборка при этом «зелёная».
 * Упавшая сборка безопаснее: Railway оставляет в работе прошлую версию.
 * Сознательно собрать без снимков (быстрая локальная проверка) — PRERENDER=skip.
 * Браузер на сервере ставит Dockerfile (системный chromium,
 * PUPPETEER_EXECUTABLE_PATH — puppeteer читает его сам).
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 4183;

/** Язык снимка: сайт шестиязычный, но индексируется по-русски. */
const SNAPSHOT_LANG = 'ru';

/**
 * Единый селектор готовности. Раньше у каждого маршрута был свой ('h1',
 * 'main'), и снимок мог сняться на полупустой странице: h1 появляется раньше
 * остального. Теперь корень каждой публичной страницы сам говорит «я готова».
 */
const READY = '[data-prerender-ready]';

/** Сколько вкладок снимает страницы одновременно. */
const CONCURRENCY = 4;

const registry = JSON.parse(await readFile(path.join(ROOT, 'src/content/site/routes.json'), 'utf8'));
const ROUTES = registry.routes;
const PRIVATE_PATHS = registry.privatePaths;

/**
 * Домен — из VITE_SITE_ORIGIN (.env), как и в index.html. Ровно одна точка
 * подстановки на весь проект. Читаем через loadEnv самого Vite, чтобы правила
 * (.env, .env.local, .env.production) совпадали с теми, по которым собирался
 * фронтенд, — иначе canonical в HTML и в sitemap.xml разъедутся.
 */
async function siteOrigin() {
  let fromFile;
  try {
    const { loadEnv } = await import('vite');
    fromFile = loadEnv('production', ROOT, 'VITE_').VITE_SITE_ORIGIN;
  } catch {
    /* vite недоступен — остаётся process.env */
  }
  const raw = (process.env.VITE_SITE_ORIGIN || fromFile || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(raw)) {
    throw new Error(
      `VITE_SITE_ORIGIN не задан или не похож на адрес ("${raw}"). Пропишите его в .env, например VITE_SITE_ORIGIN=https://example.com`,
    );
  }
  return raw;
}

/** Текст маршрута на языке снимка. */
const textOf = (value, url, field) => {
  const v = value?.[SNAPSHOT_LANG];
  if (!v) throw new Error(`в routes.json у ${url} нет поля ${field}.${SNAPSHOT_LANG}`);
  return v;
};

/**
 * Экранирование для вставки в HTML. Заголовок и описание — обычный текст из
 * реестра, но в нём легко появится «&» («риски & правки») или кавычка, и
 * страница молча получит битую разметку меты.
 */
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Подстановка значения в тег <meta>, найденный по паре «атрибут=значение».
 *
 * ДВА ГРАБЛИ, НА КОТОРЫЕ ЗДЕСЬ УЖЕ НАСТУПАЛИ:
 *
 * 1. Строка замены — только через функцию. В строке `$` служебный ($1, $&, $$),
 *    и описание вида «от $15 до $499» превратилось бы в мусор: `$1` — в первую
 *    подгруппу, `$4` — в пустоту.
 * 2. Тег ищем целиком, а не шаблоном «атрибут сразу перед content». В
 *    index.html длинные <meta> разбиты на несколько строк (property на одной,
 *    content на другой) — прежнее выражение их просто не находило, и og-описание
 *    на ВСЕХ страницах молча оставалось общим текстом главной.
 */
const setMeta = (html, attr, name, value) => {
  const tagRe = new RegExp(`<meta\\b[^>]*\\b${attr}="${name}"[^>]*>`, 'i');
  if (!tagRe.test(html)) throw new Error(`в index.html не найден <meta ${attr}="${name}"> — мета страниц не проставится`);
  return html.replace(tagRe, (tag) => tag.replace(/content="[^"]*"/i, () => `content="${escapeHtml(value)}"`));
};

/** То же для <link rel="…" href="…">. */
const setLink = (html, rel, value) => {
  const tagRe = new RegExp(`<link\\b[^>]*\\brel="${rel}"[^>]*>`, 'i');
  if (!tagRe.test(html)) throw new Error(`в index.html не найден <link rel="${rel}">`);
  return html.replace(tagRe, (tag) => tag.replace(/href="[^"]*"/i, () => `href="${escapeHtml(value)}"`));
};

/**
 * robots.txt и sitemap.xml — из ОДНОГО реестра маршрутов, а не из public/.
 * Раньше они лежали статикой с вшитым доменом: добавили публичную страницу —
 * и она просто не попала ни в карту сайта, ни в разрешения (и никто не заметил).
 */
async function writeSeoFiles(origin) {
  const loc = (url) => `${origin}${url === '/' ? '/' : url}`;

  const clash = ROUTES.filter((r) =>
    PRIVATE_PATHS.some((p) => r.url === p || r.url.startsWith(p.endsWith('/') ? p : `${p}/`)),
  );
  if (clash.length) {
    throw new Error(`публичные маршруты закрыты правилом Disallow: ${clash.map((r) => r.url).join(', ')}`);
  }

  const robots = [
    'User-agent: *',
    ...ROUTES.map((r) => `Allow: ${r.url}`),
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  await writeFile(path.join(DIST, 'robots.txt'), robots);

  const today = process.env.PRERENDER_DATE || new Date().toISOString().slice(0, 10);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ROUTES.map((r) => `  <url><loc>${loc(r.url)}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`;
  await writeFile(path.join(DIST, 'sitemap.xml'), sitemap);

  // llms.txt — визитка сайта для ИИ-ассистентов (llmstxt.org). Текст — в
  // src/content/site/llms.md, список страниц — из того же реестра: новая
  // страница попадает сюда сама, а удалённая не остаётся висеть ссылкой.
  const LEGAL_URLS = new Set(['/terms', '/privacy']);
  const SKIP_URLS = new Set(['/', '/login']);
  const line = (r) => `- [${textOf(r.title, r.url, 'title')}](${loc(r.url)}): ${textOf(r.desc, r.url, 'desc')}`;
  const llmsTemplate = await readFile(path.join(ROOT, 'src/content/site/llms.md'), 'utf8');
  const llms = llmsTemplate
    .replaceAll('{{ORIGIN}}', () => origin)
    .replace('{{PAGES}}', () => ROUTES.filter((r) => !SKIP_URLS.has(r.url) && !LEGAL_URLS.has(r.url)).map(line).join('\n'))
    .replace('{{LEGAL}}', () => ROUTES.filter((r) => LEGAL_URLS.has(r.url)).map(line).join('\n'));
  const leftoverMark = llms.match(/\{\{[A-Z]+\}\}/);
  if (leftoverMark) throw new Error(`в llms.md осталась неподставленная метка ${leftoverMark[0]}`);
  await writeFile(path.join(DIST, 'llms.txt'), llms);

  // Ключ IndexNow: поисковик проверяет, что сайт наш, по файлу <ключ>.txt.
  const key = registry.indexNowKey;
  if (!/^[a-f0-9]{32}$/.test(key ?? '')) throw new Error('в routes.json нет indexNowKey (32 шестнадцатеричных символа)');
  await writeFile(path.join(DIST, `${key}.txt`), key);

  console.log(
    `[prerender] robots.txt (${ROUTES.length} allow / ${PRIVATE_PATHS.length} disallow) + sitemap.xml (${ROUTES.length} адресов, lastmod ${today}) + llms.txt + ключ IndexNow — из реестра маршрутов, домен ${origin}`,
  );
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };

/** Снимок одной страницы: своя вкладка, свой файл. */
async function snapshot(browser, route, { template, origin }) {
  const page = await browser.newPage();
  try {
    // Force Russian (the market-primary snapshot); headless Chrome defaults en-US.
    await page.evaluateOnNewDocument((lang) => {
      try {
        localStorage.setItem('lexai.lang', lang);
      } catch {
        /* приватный режим — язык останется по умолчанию */
      }
    }, SNAPSHOT_LANG);
    // Marketing/legal pages are static + a login form; API calls may fail —
    // wait for the page's own readiness marker, not networkidle.
    await page.goto(`http://127.0.0.1:${PORT}${route.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(READY, { timeout: 30000 });
    const snap = await page.evaluate(() => document.getElementById('root')?.innerHTML ?? '');
    if (!snap || snap.length < 200) throw new Error(`empty snapshot for ${route.url}`);

    const title = textOf(route.title, route.url, 'title');
    const desc = textOf(route.desc, route.url, 'desc');
    const canonical = `${origin}${route.url === '/' ? '/' : route.url}`;

    // Splice into a fresh copy of the built template — value edits only.
    let html = template.replace('<div id="root"></div>', () => `<div id="root">${snap}</div>`);
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
    html = setMeta(html, 'name', 'description', desc);
    html = setLink(html, 'canonical', canonical);
    html = setMeta(html, 'property', 'og:url', canonical);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    // Карточка в Твиттере/X читает свои теги и на og не откатывается —
    // без этих двух строк ссылка на раздел показывала бы текст главной.
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'name', 'twitter:description', desc);

    const out = path.join(DIST, route.file);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, html);
    console.log(`[prerender] ${route.url} → dist/${route.file} (${snap.length} chars)`);
  } finally {
    await page.close();
  }
}

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error('[prerender] dist/index.html missing — run `vite build` first');
    process.exit(1);
  }

  const origin = await siteOrigin();
  const template = await readFile(path.join(DIST, 'index.html'), 'utf8');

  // Неподставленная переменная Vite в собранном HTML = битый canonical/og на
  // живом сайте. Ловим здесь, а не через месяц в поисковой выдаче.
  // Снимок вклеивается на место пустого корня. Нет пустого корня — значит,
  // dist уже снят (повторный запуск без vite build), и каждая страница молча
  // получила бы текст главной.
  if (!template.includes('<div id="root"></div>')) {
    throw new Error('в dist/index.html нет пустого <div id="root"></div> — снимки уже сделаны; пересоберите: npm run build');
  }

  const leftover = template.match(/%VITE_[A-Z0-9_]+%/);
  if (leftover) {
    throw new Error(`в dist/index.html осталась неподставленная переменная ${leftover[0]} — задайте её в .env и пересоберите`);
  }

  await writeSeoFiles(origin);

  if (process.env.PRERENDER === 'skip') {
    console.warn('[prerender] PRERENDER=skip — снимки страниц НЕ сделаны. Такую сборку нельзя выкладывать: боты увидят пустые страницы.');
    return;
  }

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    throw new Error('puppeteer не установлен — снимки страниц сделать нечем (npm i -D puppeteer). Собрать без них: PRERENDER=skip');
  }

  // Static file server over dist/ with SPA fallback to index.html.
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(DIST, urlPath);
      if (urlPath.endsWith('/')) filePath = path.join(DIST, 'index.html');
      if (!existsSync(filePath) || !path.extname(filePath)) filePath = path.join(DIST, 'index.html');
      const body = await readFile(filePath);
      res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(PORT, r));

  let browser;
  try {
    // --disable-dev-shm-usage: в контейнере /dev/shm всего 64 МБ, и вкладки
    // Chromium падают на нём посреди снимка.
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ru-RU'] });
  } catch (err) {
    server.close();
    throw new Error(
      `браузер для снимков не запустился (${err.message}). Без снимков сайт для ботов пустой — сборка остановлена. ` +
        'Собрать без них: PRERENDER=skip',
    );
  }

  const started = Date.now();
  try {
    // Пул вкладок: 13 страниц последовательно — это ~40 с на каждой сборке.
    // Очередь общая, вкладок CONCURRENCY: как только одна освободилась, она
    // берёт следующий маршрут.
    const queue = [...ROUTES];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let route = queue.shift(); route; route = queue.shift()) {
        await snapshot(browser, route, { template, origin });
      }
    });
    await Promise.all(workers);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[prerender] ${ROUTES.length}/${ROUTES.length} routes prerendered за ${Math.round((Date.now() - started) / 100) / 10} с`);
}

main().catch((err) => {
  console.error('[prerender] FAILED:', err.message);
  process.exit(1);
});
