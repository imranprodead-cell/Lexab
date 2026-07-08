/** Entrypoint: sentry → migrate → seed-if-empty → listen. */
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { getDb, migrate } from './db.ts';
import { seedIfEmpty } from './seed-data.ts';

// Error monitoring — enabled only when SENTRY_DSN is set.
if (config.sentryDsn) {
  const Sentry = await import('@sentry/node');
  Sentry.init({ dsn: config.sentryDsn, tracesSampleRate: 0.1 });
  console.log('[sentry] error monitoring enabled');
}

const db = await getDb();
const ran = await migrate(db);
if (ran.length) console.log(`[db] applied migrations: ${ran.join(', ')}`);
console.log(`[db] using ${db.kind}${db.kind === 'pglite' ? ` (embedded, data in ${config.dataDir}/pg)` : ''}`);

const seeded = await seedIfEmpty(db);
if (seeded) console.log('[db] seeded demo data (demo user: a.rahman@freshfields.com)');

if (!config.anthropicApiKey) {
  console.warn('[llm] ANTHROPIC_API_KEY is not set — /analysis and chat replies use deterministic fallbacks');
}

const app = await buildApp(db);
await app.listen({ port: config.port, host: config.host });
console.log(`LexAI API listening on http://localhost:${config.port}${config.apiPrefix}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
