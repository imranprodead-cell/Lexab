/**
 * Row Level Security на КАЖДОЙ таблице схемы public.
 *
 * Почему это тест, а не разовая миграция: миграция 004 включала RLS поимённо,
 * и следующие 48 миграций про это забывали — к аудиту 2026-08-03 без RLS
 * оказались 30 таблиц из 54 (api_keys, data_keys, audit_events, user_sessions,
 * analysis_shares, projects, user_totp…). В живой базе их закрыли руками, но
 * любое новое окружение поднялось бы открытым для anon-ключа, который лежит
 * во фронтенде. Тест падает на первой же новой таблице без RLS.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-rls-test-'));
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'rls-test-master-key-0123456789abcdefghij';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const db = await getDb();
await migrate(db);

after(async () => {
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('row level security', () => {
  it('ни одной таблицы схемы public без RLS', async () => {
    const res = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`,
    );
    assert.deepEqual(
      res.rows.map((r) => r.relname),
      [],
      'новая таблица без ENABLE ROW LEVEL SECURITY — добавьте её в миграцию вместе с CREATE TABLE',
    );
  });

  it('таблиц в схеме действительно много (проверка не выродилась в пустой список)', async () => {
    const res = await db.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    assert.ok(Number(res.rows[0]?.count ?? 0) >= 50, `таблиц: ${res.rows[0]?.count}`);
  });
});
