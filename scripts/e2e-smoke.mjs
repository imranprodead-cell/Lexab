/**
 * Браузерный E2E-смоук (puppeteer — уже в devDeps для prerender):
 * проверяет, что задеплоенный/локальный ФРОНТ реально рендерится в браузере —
 * API-тесты этого не видят (сломанный CORS/base URL/чанк дают белый экран при
 * зелёном сервере).
 *
 *   node scripts/e2e-smoke.mjs                     # против http://localhost:5173
 *   FRONT_URL=https://домен node scripts/e2e-smoke.mjs
 */
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONT_URL ?? 'http://localhost:5173').replace(/\/$/, '');

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--lang=ru-RU'] });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // 1. Лендинг: рендерится, есть заголовок и русская локаль по умолчанию.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 30_000 });
  const title = await page.title();
  ok('лендинг: title содержит Lexab', /lexab/i.test(title), title);
  const bodyText = await page.evaluate(() => document.body.innerText);
  ok('лендинг: контент отрендерен (не белый экран)', bodyText.trim().length > 200, `${bodyText.trim().length} симв.`);

  // 2. Логин-форма достижима.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30_000 });
  const loginText = await page.evaluate(() => document.body.innerText);
  ok('страница входа рендерится', /Google|вход|sign in/i.test(loginText));

  // 3. Условия использования — публичная страница.
  await page.goto(`${BASE}/terms`, { waitUntil: 'networkidle2', timeout: 30_000 });
  const termsText = await page.evaluate(() => document.body.innerText);
  ok('/terms: текст условий на месте', /Условия использования|Terms of Use/.test(termsText));

  // 4. Битая ссылка АНОНИМОМ → честный 404, а не редирект на логин.
  await page.goto(`${BASE}/definitely-not-a-page`, { waitUntil: 'networkidle2', timeout: 30_000 });
  const nfText = await page.evaluate(() => document.body.innerText);
  ok('битый URL → страница «не найдено» (не login)', /не найдена|not found/i.test(nfText), page.url());

  // 5. Ни одна из страниц не бросила необработанных JS-ошибок.
  ok('без необработанных JS-ошибок', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(failed ? `\nE2E ПРОВАЛЕН: ${failed} ✗` : '\nE2E ПРОЙДЕН: все проверки ✓');
process.exit(failed ? 1 : 0);
