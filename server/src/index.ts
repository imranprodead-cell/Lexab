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
import { googleAccessToken } from './lib/googleAuth.ts';
import { TTS_OAUTH_SCOPE, ttsAuthMode } from './routes/tts.routes.ts';
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

// Фоновые задачи под кластерным неблокирующим локом: при деплое с перекрытием
// (Railway на миг держит старый и новый инстансы) каждую задачу в такт
// выполняет РОВНО ОДИН инстанс — иначе письма-напоминания и дозвоны биллинга
// уходили бы дважды. На PGlite (один процесс) лок не нужен — работаем напрямую.
const JOB_KEYS = {
  approvals: 71001,
  billing: 71002,
  auditRetention: 71003,
  contracts: 71004,
  retention: 71005,
  sessions: 71006,
  batchResume: 71007,
  workflowsFail: 71008,
} as const;
// Задачи выполняются ПО ОДНОЙ через внутрипроцессную очередь: параллельные
// tryJobLock-клиенты + их собственные запросы через пул при PG_POOL_MAX<=8
// взаимоблокировали ВЕСЬ пул на старте (подтверждено репро-скриптом ломателя:
// 0/8 задач при пуле 8, все API-запросы висят). Очередь держит максимум
// 1 лок-клиент + запросы одной задачи — работает даже при PG_POOL_MAX=2.
let jobQueue: Promise<void> = Promise.resolve();
function runExclusive(key: number, fn: () => Promise<unknown>): void {
  jobQueue = jobQueue.then(async () => {
    try {
      if (db.tryJobLock) {
        await db.tryJobLock(key, async () => {
          await fn();
        });
      } else {
        await fn();
      }
    } catch {
      /* фоновая задача не должна ронять процесс */
    }
  });
}

// Approval-deadline reminders: check every 10 minutes (and once at boot).
runExclusive(JOB_KEYS.approvals, () => checkApprovalDeadlines(db));
setInterval(() => runExclusive(JOB_KEYS.approvals, () => checkApprovalDeadlines(db)), 10 * 60 * 1000);

// Subscription lifecycle: enforce renewals + dunning hourly (and once at boot).
runExclusive(JOB_KEYS.billing, () => checkBillingLifecycle(db));
setInterval(() => runExclusive(JOB_KEYS.billing, () => checkBillingLifecycle(db)), 60 * 60 * 1000);

// Audit-log retention: purge events past the window, daily.
runExclusive(JOB_KEYS.auditRetention, () => checkAuditRetention(db));
setInterval(() => runExclusive(JOB_KEYS.auditRetention, () => checkAuditRetention(db)), 24 * 60 * 60 * 1000);

// CLM: сроки договоров и обязательств — напоминания раз в сутки (и при старте).
runExclusive(JOB_KEYS.contracts, () => checkContractDeadlines(db));
setInterval(() => runExclusive(JOB_KEYS.contracts, () => checkContractDeadlines(db)), 24 * 60 * 60 * 1000);

// Retention: crypto-shred documents soft-deleted past the retention window, daily.
runExclusive(JOB_KEYS.retention, () => checkRetention(db));
setInterval(() => runExclusive(JOB_KEYS.retention, () => checkRetention(db)), 24 * 60 * 60 * 1000);

// Batch recovery: подобрать осиротевшие батчи (упавший инстанс перестаёт
// бампать heartbeat batch_jobs.updated_at). При старте И каждые 5 минут —
// иначе батч, чей инстанс умер ПОСЛЕ нашего старта, завис бы навсегда.
if (config.batchAutostart) {
  runExclusive(JOB_KEYS.batchResume, () => resumeBatchJobs(db));
  setInterval(() => runExclusive(JOB_KEYS.batchResume, () => resumeBatchJobs(db)), 5 * 60 * 1000);
} else {
  // Флаг предназначен ТОЛЬКО для тестов. Если он выключен в реальном запуске,
  // POST /batch будет складывать задания в очередь, но никто их не запустит —
  // громко предупреждаем, чтобы это не осталось незамеченным.
  console.warn('[batch] BATCH_AUTOSTART=0 — массовый разбор НЕ запускается автоматически (флаг только для тестов). Батчи будут копиться в очереди.');
}
// Прерванные воркфлоу: честный failed вместо «вечного processing». Тоже
// периодически — упавший ПОСЛЕ нашего старта инстанс иначе оставил бы висяки.
runExclusive(JOB_KEYS.workflowsFail, () => failInterruptedWorkflows(db));
setInterval(() => runExclusive(JOB_KEYS.workflowsFail, () => failInterruptedWorkflows(db)), 5 * 60 * 1000);

// Журнал сессий: чистка строк старше окна жизни сессии, раз в сутки.
runExclusive(JOB_KEYS.sessions, () => pruneStaleSessions(db));
setInterval(() => runExclusive(JOB_KEYS.sessions, () => pruneStaleSessions(db)), 24 * 60 * 60 * 1000);
if (seeded) console.log('[db] seeded demo data (demo user: a.rahman@freshfields.com)');

if (!config.anthropicApiKey) {
  console.warn('[llm] ANTHROPIC_API_KEY is not set — /analysis and chat replies use deterministic fallbacks');
}

const app = await buildApp(db);
await app.listen({ port: config.port, host: config.host });
console.log(`LexAI API listening on http://localhost:${config.port}${config.apiPrefix}`);

// Прогрев OAuth-токена озвучки (только сервисный аккаунт): без прогрева первый
// клик «Прочитать вслух» платит ~0.5 с за обмен JWT→token. Здесь, а не в
// buildApp — тесты строят app без сети. Рефреш чаще часа жизни токена.
if (config.googleTtsCredentialsJson && ttsAuthMode(config.googleTtsCredentialsJson) === 'service-account') {
  const warmTtsAuth = () =>
    googleAccessToken(config.googleTtsCredentialsJson, TTS_OAUTH_SCOPE).catch((err: unknown) =>
      console.warn('[tts] прогрев OAuth не удался:', String(err).slice(0, 160)),
    );
  void warmTtsAuth();
  setInterval(warmTtsAuth, 25 * 60 * 1000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Дедлайн на выключение: открытые SSE-стримы (чат/прогресс) иначе держат
    // close() бесконечно, и платформа добивает процесс SIGKILL-ом посреди
    // записи. 10 секунд на дренаж — затем выходим сами.
    const deadline = setTimeout(() => {
      console.error('[shutdown] drain deadline reached — forcing exit');
      process.exit(0);
    }, 10_000);
    deadline.unref();
    await app.close();
    await db.close();
    process.exit(0);
  });
}
