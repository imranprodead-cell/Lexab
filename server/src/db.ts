/**
 * Database adapter. Uses node-postgres when DATABASE_URL is set; otherwise
 * falls back to PGlite — real Postgres compiled to WASM, persisted under
 * DATA_DIR/pg — so local development needs no external services. Both expose
 * the same `query`/`exec` surface and run the same SQL migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run a multi-statement SQL script (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
}

let dbPromise: Promise<Db> | null = null;

async function createDb(): Promise<Db> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    // Managed Postgres (Supabase & co) requires TLS; local docker Postgres doesn't.
    const useSsl = /supabase\.(co|com)|sslmode=require/.test(config.databaseUrl);
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    // An idle pooled connection can error at any time (network change, pooler
    // restart). Without this handler Node crashes the whole process
    // ("Unhandled 'error' event"); with it the pool just drops the dead client
    // and opens a fresh one on the next query.
    pool.on('error', (err) => {
      console.warn(`[db] idle connection error (recovered): ${err.message}`);
    });
    return {
      kind: 'postgres',
      query: async (sql, params) => {
        const res = await pool.query(sql, params as never[]);
        return { rows: res.rows };
      },
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(config.dataDir, 'pg');
  fs.mkdirSync(dir, { recursive: true });
  const lite = await PGlite.create(dir);
  return {
    kind: 'pglite',
    query: async (sql, params) => {
      const res = await lite.query(sql, params as never[]);
      return { rows: res.rows as never[] };
    },
    exec: async (sql) => {
      await lite.exec(sql);
    },
    close: () => lite.close(),
  };
}

export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = createDb();
  return dbPromise;
}

/** Apply migrations/*.sql in filename order, tracked in schema_migrations. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Apply + record atomically, so a crash (or a racing second process)
    // can never leave a migration half-applied but unrecorded.
    await db.exec(
      `BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`,
    );
    ran.push(file);
  }
  return ran;
}
