/**
 * Проверка памяток специалистов (lib/specialists.ts) против базы — ТОЛЬКО ЧТЕНИЕ.
 *
 *   PG_POOL_MAX=3 node --env-file-if-exists=.env scripts/specialists-check.ts [--print]
 *
 * Падает (exit 1), если:
 *  - норма из карты памятки не найдена в базе или не действует сегодня
 *    (после переингеста номера статей могли сдвинуться);
 *  - памятка длиннее MAX_GUIDE_CHARS (она целиком уходит модели);
 *  - набор evals/golden/uz-specialists.jsonl ссылается на несуществующую
 *    норму или называет неизвестную памятку.
 * --print — показать памятки так, как их увидит модель (для вычитки).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/db.ts';
import { MAX_GUIDE_CHARS, SPECIALISTS, renderGuide, specialistById, specialistUnitIds } from '../src/lib/specialists.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const print = process.argv.includes('--print');
  const db = await getDb();
  let failed = false;

  for (const spec of SPECIALISTS) {
    const guide = await renderGuide(db, spec);
    const tooLong = guide.text.length > MAX_GUIDE_CHARS;
    const ok = !guide.missing.length && !tooLong;
    if (!ok) failed = true;
    console.log(
      `${ok ? '✓' : '✗'} ${spec.id}: норм ${guide.units.length}, знаков ${guide.text.length}` +
        (guide.missing.length ? ` — НЕТ В БАЗЕ: ${guide.missing.join(', ')}` : '') +
        (tooLong ? ` — длиннее ${MAX_GUIDE_CHARS}` : ''),
    );
    if (print) console.log(`\n${guide.text}\n\n${'─'.repeat(80)}\n`);
  }

  const goldenPath = path.join(HERE, '..', 'evals', 'golden', 'uz-specialists.jsonl');
  if (existsSync(goldenPath)) {
    const rows = readFileSync(goldenPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { question: string; must_cite: string[][]; must_not_cite: string[]; facts: string[]; guide?: string });
    const ids = [...new Set(rows.flatMap((r) => [...r.must_cite.flat(), ...r.must_not_cite]))];
    const found = new Set((await db.query<{ id: string }>('SELECT id FROM legal_units WHERE id = ANY($1::text[])', [ids])).rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    const badGuide = rows.filter((r) => r.guide && !specialistById(r.guide)).map((r) => r.guide);
    const badRegex = rows.flatMap((r) =>
      r.facts.filter((f) => {
        try {
          new RegExp(f, 'iu');
          return false;
        } catch {
          return true;
        }
      }),
    );
    // Норма из набора, которой нет в карте её памятки, — не ошибка (агент может
    // найти её поиском), но вычитывающему стоит это видеть.
    const outside = rows.flatMap((r) => {
      const spec = r.guide ? specialistById(r.guide) : undefined;
      if (!spec) return [];
      const inMap = new Set(specialistUnitIds(spec));
      return r.must_cite.filter((g) => !g.some((id) => inMap.has(id))).map((g) => `${r.guide}: ${g.join('|')}`);
    });
    const ok = !missing.length && !badGuide.length && !badRegex.length;
    if (!ok) failed = true;
    console.log(
      `${ok ? '✓' : '✗'} golden uz-specialists: вопросов ${rows.length}, норм ${ids.length}` +
        (missing.length ? ` — НЕТ В БАЗЕ: ${missing.join(', ')}` : '') +
        (badGuide.length ? ` — неизвестная памятка: ${badGuide.join(', ')}` : '') +
        (badRegex.length ? ` — негодное выражение: ${badRegex.join(' ; ')}` : ''),
    );
    if (outside.length) console.log(`  (вне карты памятки: ${outside.join('; ')})`);
    const perGuide = new Map<string, number>();
    for (const r of rows) perGuide.set(r.guide ?? '—', (perGuide.get(r.guide ?? '—') ?? 0) + 1);
    console.log(`  по памяткам: ${[...perGuide].map(([g, n]) => `${g} ${n}`).join(', ')}`);
  }

  await db.close();
  process.exit(failed ? 1 : 0);
}

void main();
