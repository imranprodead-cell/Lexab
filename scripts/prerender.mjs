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
 * Gracefully SKIPS (exit 0, build still succeeds) when puppeteer is not
 * installed — enable prerender with:  npm i -D puppeteer
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://lexai.app';
const PORT = 4183;

// Per-route metadata baked into the snapshot (title + description + path).
const ROUTES = [
  { url: '/', file: 'index.html', wait: 'h1', title: 'Lexab — ИИ-анализ договоров', desc: 'ИИ-анализ договоров: риски, редлайны и вопросы по пунктам с проверяемыми ссылками на законы — за минуты.' },
  { url: '/login', file: 'login/index.html', wait: 'h1', title: 'Вход в Lexab — ИИ-анализ договоров', desc: 'Войдите в Lexab: ИИ-анализ договоров с проверяемыми ссылками на законодательство.' },
  { url: '/terms', file: 'terms/index.html', wait: 'main', title: 'Условия использования — Lexab', desc: 'Условия использования Lexab.' },
  { url: '/privacy', file: 'privacy/index.html', wait: 'main', title: 'Политика конфиденциальности — Lexab', desc: 'Как Lexab обрабатывает и защищает ваши данные.' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error('[prerender] dist/index.html missing — run `vite build` first');
    process.exit(1);
  }

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.warn('[prerender] puppeteer not installed — SKIPPING prerender (build still valid). Enable with: npm i -D puppeteer');
    return;
  }

  const template = await readFile(path.join(DIST, 'index.html'), 'utf8');

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
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--lang=ru-RU'] });
  } catch (err) {
    // Browser binary missing (e.g. a CI that blocked puppeteer's postinstall).
    // Prerender is an enhancement — skip rather than break the build.
    console.warn(`[prerender] browser unavailable — SKIPPING prerender (build still valid): ${err.message}`);
    server.close();
    return;
  }
  let done = 0;
  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      // Force Russian (the market-primary snapshot); headless Chrome defaults en-US.
      await page.evaluateOnNewDocument(() => {
        try { localStorage.setItem('lexai.lang', 'ru'); } catch {}
      });
      // Marketing/legal pages are static + a login form; API calls may fail —
      // wait for the route's own element, not networkidle.
      await page.goto(`http://127.0.0.1:${PORT}${route.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector(route.wait, { timeout: 30000 });
      const snapshot = await page.evaluate(() => document.getElementById('root')?.innerHTML ?? '');
      await page.close();
      if (!snapshot || snapshot.length < 200) throw new Error(`empty snapshot for ${route.url}`);

      // Splice into a fresh copy of the built template — value edits only.
      const canonical = `${ORIGIN}${route.url === '/' ? '/' : route.url}`;
      let html = template
        .replace('<div id="root"></div>', `<div id="root">${snapshot}</div>`)
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`)
        .replace(/(<meta name="description" content=")[^"]*(")/, `$1${route.desc}$2`)
        .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
        .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`)
        .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${route.title}$2`)
        .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${route.desc}$2`);

      const out = path.join(DIST, route.file);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, html);
      console.log(`[prerender] ${route.url} → dist/${route.file} (${snapshot.length} chars)`);
      done++;
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Regenerate the sitemap with today's lastmod (build date passed via arg or now).
  const today = process.env.PRERENDER_DATE || new Date().toISOString().slice(0, 10);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ROUTES.map((r) => `  <url><loc>${ORIGIN}${r.url === '/' ? '/' : r.url}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`;
  await writeFile(path.join(DIST, 'sitemap.xml'), sitemap);
  console.log(`[prerender] ${done}/${ROUTES.length} routes prerendered; sitemap.xml regenerated (lastmod ${today})`);
}

main().catch((err) => {
  console.error('[prerender] FAILED:', err.message);
  process.exit(1);
});
