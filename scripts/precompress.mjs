/**
 * Предсжатие dist/ в sidecar-файлы .gz + .br (чистый node:zlib, ноль новых
 * зависимостей). Хосты с поддержкой precompressed-статики (nginx gzip_static/
 * brotli_static, Caddy precompressed, @fastify/static preCompressed,
 * большинство CDN) отдадут их без CPU на лету; остальные просто игнорируют
 * лишние файлы — безвредно везде. Запускается ПОСЛЕ prerender.mjs, чтобы
 * сжать и пререндеренные login/terms/privacy + sitemap.xml.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
// .gz/.br сами под маску не попадают — повторный прогон не жмёт сжатое.
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|xml|txt|ico)$/;
const MIN_BYTES = 1024; // крохи не сжимаем — заголовки съедят выгоду

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
let raw = 0;
let gz = 0;
let br = 0;
for await (const file of walk(DIST)) {
  if (!COMPRESSIBLE.test(file)) continue;
  const buf = await readFile(file);
  if (buf.length < MIN_BYTES) continue;
  const [g, b] = await Promise.all([
    gzip(buf, { level: 9 }),
    brotli(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }),
  ]);
  if (g.length < buf.length) await writeFile(`${file}.gz`, g);
  if (b.length < buf.length) await writeFile(`${file}.br`, b);
  files += 1;
  raw += buf.length;
  gz += g.length;
  br += b.length;
}

const kb = (n) => `${Math.round(n / 1024)} КБ`;
console.log(`[precompress] ${files} файлов: ${kb(raw)} → ${kb(gz)} gzip / ${kb(br)} brotli`);

/* ── Упоры веса первой загрузки ──────────────────────────────────────────────
 *
 * Сборка ПАДАЕТ, если первая загрузка потолстела. Без этого вес расползается
 * незаметно: каждый отдельный импорт кажется мелочью, а вместе они однажды
 * дают +60 КБ, и об этом узнаёшь от пользователя со слабым интернетом.
 *
 * Цифры — не «на глаз», а замер боевой сборки 2026-08-05 плюс небольшой запас.
 * Растёт по делу (новая большая возможность на первом экране) — поднимайте
 * порог ОСОЗНАННО, одной строкой и с новым замером в HANDOFF.md.
 */
const LIMITS = {
  entryJs: 62 * 1024, // главный чанк: замер 54 КБ
  entryCss: 8 * 1024, //  главный CSS: замер 6 КБ
  firstLoad: 160 * 1024, // всё, что тянет браузер до первого экрана: замер 148 КБ
};

const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
const assets = [
  ...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+)"/g),
  ...html.matchAll(/<link[^>]+href="(\/assets\/[^"]+)"[^>]*rel="(?:modulepreload|stylesheet)"/g),
  ...html.matchAll(/<link[^>]+rel="(?:modulepreload|stylesheet)"[^>]*href="(\/assets\/[^"]+)"/g),
].map((m) => m[1]);
const unique = [...new Set(assets)];

const sizeOf = async (assetPath) => {
  try {
    return (await readFile(path.join(DIST, assetPath.replace(/^\//, '') + '.gz'))).length;
  } catch {
    // Мелкие файлы не сжимаются (см. MIN_BYTES) — берём исходный размер.
    return (await readFile(path.join(DIST, assetPath.replace(/^\//, '')))).length;
  }
};

const problems = [];
let firstLoad = 0;
for (const asset of unique) {
  const size = await sizeOf(asset);
  firstLoad += size;
  const name = path.basename(asset);
  if (/^index-.*\.js$/.test(name) && size > LIMITS.entryJs) {
    problems.push(`главный чанк ${name} — ${kb(size)} при пороге ${kb(LIMITS.entryJs)}`);
  }
  if (/^index-.*\.css$/.test(name) && size > LIMITS.entryCss) {
    problems.push(`главный CSS ${name} — ${kb(size)} при пороге ${kb(LIMITS.entryCss)}`);
  }
  // Библиотека анимаций (48 КБ) не должна грузиться до первого экрана: её
  // используют только кабинет и лендинг, и оба подгружают её сами.
  if (/motion/.test(name)) {
    problems.push(`библиотека анимаций ${name} снова попала в первую загрузку — ищите жёсткий импорт motion/react в общем коде`);
  }
}
if (firstLoad > LIMITS.firstLoad) {
  problems.push(`первая загрузка ${kb(firstLoad)} при пороге ${kb(LIMITS.firstLoad)} (${unique.length} файлов)`);
}

console.log(`[precompress] первая загрузка: ${kb(firstLoad)} gzip в ${unique.length} файлах (порог ${kb(LIMITS.firstLoad)})`);
if (problems.length) {
  console.error('\n[precompress] ПРЕВЫШЕН БЮДЖЕТ ВЕСА:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
