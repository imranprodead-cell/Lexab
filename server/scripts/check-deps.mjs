/**
 * «Чистая комната» на скорую руку: сверяет bare-импорты серверного кода со
 * списком зависимостей в server/package.json.
 *
 * Зачем: `server/` лежит ВНУТРИ корня фронтенда, поэтому Node и tsc при
 * резолве поднимаются в РОДИТЕЛЬСКИЙ node_modules. Незаявленная зависимость
 * локально «работает» и молча маскируется — ровно так `undici` доехал до
 * прода и уронил старт сервера в чистой установке (2026-08-03), а серверная
 * работа CI краснела с коммита 08f70e9.
 *
 *   node scripts/check-deps.mjs      # 0 — всё объявлено, 1 — есть дыры
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const SCAN_DIRS = ['src', 'test', 'scripts', 'evals'];
const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 'undici' → 'undici'; '@scope/pkg/sub' → '@scope/pkg'; относительные — null. */
function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const missing = new Map();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'reports') continue;
      walk(full);
      continue;
    }
    if (!/\.(ts|mts|mjs|js)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      const name = packageOf(spec);
      if (!name || builtins.has(name) || declared.has(name)) continue;
      const list = missing.get(name) ?? [];
      list.push(path.relative(root, full));
      missing.set(name, list);
    }
  }
}

for (const dir of SCAN_DIRS) {
  const full = path.join(root, dir);
  if (fs.existsSync(full)) walk(full);
}

if (missing.size === 0) {
  console.log('✓ все внешние импорты сервера объявлены в package.json');
  process.exit(0);
}
console.error('✗ импорты БЕЗ объявленной зависимости (в чистой установке сервер их не найдёт):');
for (const [name, files] of missing) {
  console.error(`  - ${name}  ← ${[...new Set(files)].slice(0, 3).join(', ')}`);
}
console.error('\nДобавьте их в server/package.json (npm install <name>) — иначе сервер не поднимется на деплое.');
process.exit(1);
