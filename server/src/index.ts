/** Entrypoint: sentry → migrate → seed-if-empty → listen. */
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { checkApprovalDeadlines } from './routes/approvals.routes.ts';
import { checkAuditRetention } from './routes/audit.routes.ts';
import { checkContractDeadlines } from './routes/contracts.routes.ts';
import { checkRetention } from './routes/documents.routes.ts';
import { resumeBatchJobs } from './routes/batch.routes.ts';
import { failInterruptedWorkflows } from './routes/workflows.routes.ts';
import { pruneStaleSessions } from './routes/security.routes.ts';
import { checkBillingLifecycle } from './lib/billing.ts';
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

const seeded = config.seedDemoData ? await seedIfEmpty(db) : false;

// Approval-deadline reminders: check every 10 minutes (and once at boot).
void checkApprovalDeadlines(db).catch(() => undefined);
setInterval(() => void checkApprovalDeadlines(db).catch(() => undefined), 10 * 60 * 1000);

// Subscription lifecycle: enforce renewals + dunning hourly (and once at boot).
void checkBillingLifecycle(db).catch(() => undefined);
setInterval(() => void checkBillingLifecycle(db).catch(() => undefined), 60 * 60 * 1000);

// Audit-log retention: purge events past the window, daily.
void checkAuditRetention(db).catch(() => undefined);
setInterval(() => void checkAuditRetention(db).catch(() => undefined), 24 * 60 * 60 * 1000);

// CLM: сроки договоров и обязательств — напоминания раз в сутки (и при старте).
void checkContractDeadlines(db).catch(() => undefined);
setInterval(() => void checkContractDeadlines(db).catch(() => undefined), 24 * 60 * 60 * 1000);

// Retention: crypto-shred documents soft-deleted past the retention window, daily.
void checkRetention(db).catch(() => undefined);
setInterval(() => void checkRetention(db).catch(() => undefined), 24 * 60 * 60 * 1000);

// Boot recovery: доработать батчи, прерванные перезапуском, и честно закрыть
// прерванные воркфлоу-запуски (не «вечное processing» в интерфейсе).
if (config.batchAutostart) {
  void resumeBatchJobs(db).catch(() => undefined);
} else {
  // Флаг предназначен ТОЛЬКО для тестов. Если он выключен в реальном запуске,
  // POST /batch будет складывать задания в очередь, но никто их не запустит —
  // громко предупреждаем, чтобы это не осталось незамеченным.
  console.warn('[batch] BATCH_AUTOSTART=0 — массовый разбор НЕ запускается автоматически (флаг только для тестов). Батчи будут копиться в очереди.');
}
void failInterruptedWorkflows(db).catch(() => undefined);

// Журнал сессий: чистка строк старше окна жизни сессии, раз в сутки.
void pruneStaleSessions(db).catch(() => undefined);
setInterval(() => void pruneStaleSessions(db).catch(() => undefined), 24 * 60 * 60 * 1000);
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
