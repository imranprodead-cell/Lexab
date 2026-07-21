/**
 * Проверка НАСТОЯЩЕГО Postgres перед/после деплоя: тесты гоняются на PGlite,
 * а миграции авто-применяются при старте сервера — расхождение движков всплыло
 * бы только падением API в проде. Скрипт применяет отставшие миграции и
 * прогоняет санити-проверки движка (FTS-словари, pgvector, immutable-триггер).
 *
 *   PG_POOL_MAX=2 node --env-file=.env scripts/verify-db.ts
 */
import { getDb, migrate } from '../src/db.ts';

const db = await getDb();
if (db.kind !== 'postgres') {
  console.error('DATABASE_URL не задан — проверять нечего (сейчас PGlite).');
  process.exit(1);
}

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

// 1. Миграции: применить отставшие (идемпотентно, под advisory-локом).
try {
  const ran = await migrate(db);
  ok('миграции применяются без ошибок', true, ran.length ? `применены: ${ran.join(', ')}` : 'все уже применены');
} catch (err) {
  ok('миграции применяются без ошибок', false, (err as Error).message);
}

const applied = await db.query<{ count: string | number }>('SELECT count(*) AS count FROM schema_migrations');
ok('schema_migrations заполнена', Number(applied.rows[0]?.count ?? 0) >= 26, `${applied.rows[0]?.count} строк`);

// 2. Языкозависимый FTS (миграции 015 ru, 023 de) — стеммеры движка.
const ru = await db.query<{ v: string }>("SELECT to_tsvector('russian', 'договорами поставок')::text AS v");
ok('русский FTS-стеммер', /договор/.test(ru.rows[0]?.v ?? ''), ru.rows[0]?.v ?? '');
const de = await db.query<{ v: string }>("SELECT to_tsvector('german', 'Verträge Kaufverträge')::text AS v");
ok('немецкий FTS-стеммер', (de.rows[0]?.v ?? '').length > 0, de.rows[0]?.v ?? '');

// 3. pgvector: расширение живо и колонка embedding существует.
try {
  await db.query("SELECT '[1,2,3]'::vector(3)");
  ok('pgvector установлен', true);
} catch (err) {
  ok('pgvector установлен', false, (err as Error).message);
}
const emb = await db.query<{ count: string | number }>(
  "SELECT count(*) AS count FROM information_schema.columns WHERE table_name = 'chunks' AND column_name = 'embedding'",
);
ok('chunks.embedding на месте', Number(emb.rows[0]?.count ?? 0) === 1);

// 4. Append-only аудит: триггер, запрещающий UPDATE/DELETE, существует.
const trg = await db.query<{ count: string | number }>(
  "SELECT count(*) AS count FROM information_schema.triggers WHERE event_object_table = 'audit_events'",
);
ok('immutable-триггер аудита', Number(trg.rows[0]?.count ?? 0) >= 1, `${trg.rows[0]?.count} триггеров`);

// 5. Ключевые таблицы фич досягаемы (простые SELECT 1 LIMIT 0 — без данных).
for (const table of ['users', 'documents', 'analyses', 'chunks', 'batch_jobs', 'workflow_runs', 'contract_terms', 'saved_templates']) {
  try {
    await db.query(`SELECT 1 FROM ${table} LIMIT 0`);
    ok(`таблица ${table}`, true);
  } catch (err) {
    ok(`таблица ${table}`, false, (err as Error).message);
  }
}

await db.close();
console.log(failed ? `\nПРОВЕРКА ПРОВАЛЕНА: ${failed} ✗` : '\nБАЗА ГОТОВА: все проверки ✓');
process.exit(failed ? 1 : 0);
