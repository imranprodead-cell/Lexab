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
