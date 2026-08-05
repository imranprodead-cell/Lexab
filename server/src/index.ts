/** Entrypoint: sentry → migrate → seed-if-empty → listen. */
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { checkApprovalDeadlines } from './routes/approvals.routes.ts';
import { checkAuditRetention } from './routes/audit.routes.ts';
import { checkContractDeadlines } from './routes/contracts.routes.ts';
import { checkRetention } from './routes/documents.routes.ts';
import { resumeBatchJobs } from './routes/batch.routes.ts';
import { failInterruptedApiRequests, pruneApiRequests } from './routes/public-api.routes.ts';
import { pruneWebhookDeliveries, runWebhookDeliveries } from './lib/apiWebhooks.ts';
import { failInterruptedWorkflows } from './routes/workflows.routes.ts';
import { pruneStaleSessions } from './routes/security.routes.ts';
import { checkSignatureReminders } from './routes/signatures.routes.ts';
import { checkBillingLifecycle } from './lib/billing.ts';
import { sendWeeklyDigests } from './lib/weeklyDigest.ts';
import { googleAccessToken } from './lib/googleAuth.ts';
import { TTS_OAUTH_SCOPE, ttsAuthMode } from './routes/tts.routes.ts';
import { getDb, migrate } from './db.ts';
import { seedIfEmpty } from './seed-data.ts';

// Error monitoring — enabled only when SENTRY_DSN is set.
if (config.sentryDsn) {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: config.sentryDsn,
    tracesSampleRate: 0.1,
    // Токены-предъявители (ссылка на подпись, на согласование, публичный отчёт,
    // ключ файла в хранилище, OAuth-код) не должны уезжать во внешний сервис
    // вместе с URL ошибки — та же редакция, что в лог доступа (app.ts).
    beforeSend(event) {
      const redact = (url: string): string =>
        url
          .replace(/(\/(?:sign|approve|invite-info|share|files|tts\/stream)\/)[^/?#]+/g, '$1[redacted]')
          .replace(/([?&](?:code|token|state)=)[^&]+/gi, '$1[redacted]');
      if (event.request?.url) event.request.url = redact(event.request.url);
      if (typeof event.request?.query_string === 'string') event.request.query_string = redact(event.request.query_string);
      return event;
    },
  });
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
  signReminders: 71009,
  weeklyDigest: 71010,
  apiRequestsFail: 71011,
  apiRequestsPrune: 71012,
  webhookDeliver: 71013,
  webhookPrune: 71014,
} as const;
// Задачи выполняются ПО ОДНОЙ через внутрипроцессную очередь: параллельные
// tryJobLock-клиенты + их собственные запросы через пул при PG_POOL_MAX<=8
// взаимоблокировали ВЕСЬ пул на старте (подтверждено репро-скриптом ломателя:
// 0/8 задач при пуле 8, все API-запросы висят). Очередь держит максимум
// 1 лок-клиент + запросы одной задачи — работает даже при PG_POOL_MAX=2.
let jobQueue: Promise<void> = Promise.resolve();

/** Имя задачи по её ключу — для внятного лога вместо голого числа. */
const JOB_NAME = new Map<number, string>(Object.entries(JOB_KEYS).map(([name, key]) => [key, name]));

/**
 * Жёсткий потолок на такт одной задачи. Все 14 задач стоят в ОДНОЙ
 * последовательной очереди, поэтому одна зависшая (медленный внешний вызов,
 * подвисшее соединение с базой) раньше останавливала и биллинг, и напоминания
 * подписантам, и crypto-shred — навсегда и молча (аудит 2026-08-03).
 */
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

function withTimeout<T>(name: string, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`задача «${name}» не уложилась в ${JOB_TIMEOUT_MS / 1000} с`)), JOB_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function runExclusive(key: number, fn: () => Promise<unknown>): void {
  const name = JOB_NAME.get(key) ?? String(key);
  jobQueue = jobQueue.then(async () => {
    try {
      if (db.tryJobLock) {
        await db.tryJobLock(key, async () => {
          await withTimeout(name, Promise.resolve().then(fn));
        });
      } else {
        await withTimeout(name, Promise.resolve().then(fn));
      }
    } catch (err) {
      // Раньше здесь стоял ПУСТОЙ catch: падение любой из 14 задач не оставляло
      // ни строки в логе, ни события в Sentry — тихо умирали биллинг,
      // напоминания подписантам и стирание удалённых документов.
      console.error(`[jobs] задача «${name}» упала: ${err instanceof Error ? err.message : String(err)}`);
      if (config.sentryDsn) {
        void import('@sentry/node').then((Sentry) => Sentry.captureException(err, { tags: { job: name } })).catch(() => undefined);
      }
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

// Э-подписи: подписант молчит 3+ дня → напоминание ему + заметка владельцу.
runExclusive(JOB_KEYS.signReminders, () => checkSignatureReminders(db));
setInterval(() => runExclusive(JOB_KEYS.signReminders, () => checkSignatureReminders(db)), 24 * 60 * 60 * 1000);

// Понедельничная сводка (сама проверяет день недели и дедуп по digest_sent_at).
runExclusive(JOB_KEYS.weeklyDigest, () => sendWeeklyDigests(db));
setInterval(() => runExclusive(JOB_KEYS.weeklyDigest, () => sendWeeklyDigests(db)), 24 * 60 * 60 * 1000);

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

// Осиротевшие задания публичного API (инстанс умер посреди анализа) — честная
// ошибка interrupted + возврат месячного юнита, вместо вечного processing.
runExclusive(JOB_KEYS.apiRequestsFail, () => failInterruptedApiRequests(db));
setInterval(() => runExclusive(JOB_KEYS.apiRequestsFail, () => failInterruptedApiRequests(db)), 5 * 60 * 1000);

// Ретеншен журнала API: терминальные строки старше 90 дней, раз в сутки.
runExclusive(JOB_KEYS.apiRequestsPrune, () => pruneApiRequests(db));
setInterval(() => runExclusive(JOB_KEYS.apiRequestsPrune, () => pruneApiRequests(db)), 24 * 60 * 60 * 1000);

// Доставка callback-вебхуков: дозревшие ретраи, раз в минуту под кластер-локом.
runExclusive(JOB_KEYS.webhookDeliver, () => runWebhookDeliveries(db));
setInterval(() => runExclusive(JOB_KEYS.webhookDeliver, () => runWebhookDeliveries(db)), 60 * 1000);
// Ретеншен журнала доставок: терминальные старше 30 дней, раз в сутки.
runExclusive(JOB_KEYS.webhookPrune, () => pruneWebhookDeliveries(db));
setInterval(() => runExclusive(JOB_KEYS.webhookPrune, () => pruneWebhookDeliveries(db)), 24 * 60 * 60 * 1000);

// Журнал сессий: чистка строк старше окна жизни сессии, раз в сутки.
runExclusive(JOB_KEYS.sessions, () => pruneStaleSessions(db));
setInterval(() => runExclusive(JOB_KEYS.sessions, () => pruneStaleSessions(db)), 24 * 60 * 60 * 1000);
if (seeded) console.log('[db] seeded demo data (demo user: a.rahman@freshfields.com)');

if (!config.anthropicApiKey) {
  console.warn('[llm] ANTHROPIC_API_KEY is not set — /analysis and chat replies use deterministic fallbacks');
}

const app = await buildApp(db);
await app.listen({ port: config.port, host: config.host });
console.log(`Lexab API listening on http://localhost:${config.port}${config.apiPrefix}`);

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
