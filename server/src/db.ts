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

/** The subset every helper needs — satisfied by both `Db` and a transaction. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  /** Run a multi-statement SQL script (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
  /**
   * Run `fn` inside a single transaction: every write commits together, or
   * all roll back if `fn` throws — so a multi-step write can't leave orphans.
   */
  withTx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Run `fn` while holding a cluster-wide Postgres advisory lock (session-level,
   * on a dedicated connection). Used to serialize migrations across replicas so
   * two cold-starting instances can't both apply the same migration. Absent on
   * PGlite (single process → no race possible), so callers must treat it as
   * optional and fall back to running `fn` directly.
   * `fn` receives a queryable bound to the SAME connection that holds the lock —
   * running the work through the pool instead would need a second connection
   * and deadlock a PG_POOL_MAX=1 boot.
   */
  withLock?<T>(key: number, fn: (locked: LockedQueryable) => Promise<T>): Promise<T>;
}

/** Query surface handed to a withLock callback (bound to the lock connection). */
export interface LockedQueryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

let dbPromise: Promise<Db> | null = null;

/**
 * TLS options with REAL certificate validation. Supabase chains to its own
 * private root ("Supabase Root 2021 CA", shipped in certs/ — a public cert,
 * not a secret), so the system trust store can't verify it; we pin that root
 * instead. Without validation the connection is encrypted but unauthenticated
 * — a MITM could read/alter all DB traffic. DATABASE_CA_CERT_PATH overrides
 * the CA for other providers; DATABASE_TLS_INSECURE=1 is a labelled dev-only
 * escape hatch. A missing/unreadable CA file fails the boot loudly rather
 * than silently downgrading security.
 */
function resolveSslOptions(): { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
  if (config.databaseTlsInsecure) {
    console.warn('[db] DATABASE_TLS_INSECURE=1 — TLS certificate validation is OFF. Never use this in production.');
    return { rejectUnauthorized: false };
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const caPath = config.databaseCaCertPath || path.join(here, '..', 'certs', 'supabase-root-2021-ca.pem');
  try {
    return { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  } catch (err) {
    throw new Error(
      `DB CA certificate is not readable at ${caPath} (${(err as Error).message}). ` +
        'Restore the file, point DATABASE_CA_CERT_PATH at your provider\'s CA, ' +
        'or set DATABASE_TLS_INSECURE=1 (dev only) to skip validation.',
    );
  }
}

async function createDb(): Promise<Db> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    // Managed Postgres (Supabase & co) requires TLS; local docker Postgres doesn't.
    const useSsl = /supabase\.(co|com)|sslmode=require/.test(config.databaseUrl);
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      // Supabase session-pooler даёт всего 15 сессий на проект. Сервер + любой
      // батч-скрипт (eval/ингест) с дефолтными max=10 вдвоём пробивают лимит
      // (EMAXCONNSESSION). Скрипты запускаются с PG_POOL_MAX=4.
      max: Math.max(1, Number(process.env.PG_POOL_MAX ?? 10) || 10),
      ...(useSsl ? { ssl: resolveSslOptions() } : {}),
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
      withTx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            query: async (sql, params) => ({ rows: (await client.query(sql, params as never[])).rows }),
          });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* connection already broken */
          }
          throw err;
        } finally {
          client.release();
        }
      },
      withLock: async (key, fn) => {
        // Hold a session-level advisory lock on a dedicated client for the whole
        // callback. Other replicas' pg_advisory_lock() blocks until we release,
        // so migrations run one replica at a time. The callback works through
        // THIS client (not the pool) — see the interface note re PG_POOL_MAX=1.
        const client = await pool.connect();
        try {
          await client.query('SELECT pg_advisory_lock($1)', [key]);
          return await fn({
            query: async (sql, params) => ({ rows: (await client.query(sql, params as never[])).rows as never[] }),
            exec: async (sql) => {
              await client.query(sql);
            },
          });
        } catch (err) {
          // Миграция могла упасть посреди BEGIN/COMMIT, оставив соединение в
          // аборченной транзакции. Откатываем, иначе и unlock упадёт (25P02), и
          // отравленное соединение вернётся в пул.
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        } finally {
          try {
            await client.query('SELECT pg_advisory_unlock($1)', [key]);
          } catch {
            /* connection already broken — the lock releases when it closes */
          }
          client.release();
        }
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
    withTx: async (fn) =>
      lite.transaction(async (tx) =>
        fn({ query: async (sql, params) => ({ rows: (await tx.query(sql, params as never[])).rows as never[] }) }),
      ),
    close: () => lite.close(),
  };
}

export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = createDb();
  return dbPromise;
}

/** Apply migrations/*.sql in filename order, tracked in schema_migrations. */
export async function migrate(db: Db): Promise<string[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];

  // Read the ledger and apply every pending migration. Run INSIDE the advisory
  // lock (below) and THROUGH the lock's own connection, so a replica that
  // acquired the lock before us is reflected in `applied` — and a PG_POOL_MAX=1
  // deployment can still boot (lock + DDL share one connection). The ledger
  // table itself is created HERE (inside the lock) — `CREATE TABLE IF NOT EXISTS`
  // is not race-safe, so two cold-starting replicas must not run it concurrently.
  const applyPending = async (q: { query: Db['query']; exec: Db['exec'] } = db): Promise<void> => {
    await q.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await q.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      // Apply + record atomically, so a crash can never leave a migration
      // half-applied but unrecorded.
      await q.exec(
        `BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`,
      );
      ran.push(file);
    }
  };

  // Serialize concurrent boots (multiple replicas cold-starting on the same DB)
  // so they can't both apply the same non-idempotent migration and crash one
  // instance on a duplicate CREATE. PGlite has no cross-process race → run direct.
  const MIGRATION_LOCK_KEY = 741_852_963; // arbitrary fixed key shared by all replicas
  if (db.withLock) await db.withLock(MIGRATION_LOCK_KEY, (locked) => applyPending(locked));
  else await applyPending();
  return ran;
}
