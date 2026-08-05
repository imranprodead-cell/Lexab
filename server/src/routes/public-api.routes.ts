/**
 * Публичный API Lexab (тариф Business) — POST/GET /api/v1/*.
 *
 * Внешние компании подключают анализ договоров к своим системам по API-ключу
 * (Authorization: Bearer lxb_… или X-API-Key). Анализ асинхронный: POST
 * /v1/analyses создаёт задание (202 + id), клиент поллит GET /v1/analyses/:id
 * до done|error — LLM работает 1–5 минут, синхронный ответ упирался бы в
 * тайм-ауты клиентов. Ядро — общий конвейер analyzeSource → persistAnalysis
 * (то же качество и та же валидация цитат, что на сайте); готовый анализ —
 * обычная строка documents/analyses, видна владельцу в кабинете.
 *
 * Ошибки в формате { error: { code, message } } (скоуповый error handler) —
 * аудитория этого неймспейса — внешние разработчики.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, assertValidFileContent, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import type { ApiScope } from '../lib/apiKeys.ts';
import { audit, type AuditEventType } from '../lib/audit.ts';
import { decJsonFromJsonb, decText, encJsonForJsonb } from '../lib/docCrypto.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { apiMonthlyUsage, releaseApiRequest, reserveApiRequest, withAiRequest } from '../lib/limits.ts';
import { generateCompare, generateContractDraft, generateTemplateDraft, type GeneratedAnalysis, type TemplateFields } from '../llm.ts';
import { createWebhookEndpoint, enqueueJobWebhooks, listWebhookEndpoints, revokeWebhookEndpoint } from '../lib/apiWebhooks.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import { deleteFile } from '../storage.ts';
import { buildOpenApiSpec } from '../lib/openapiSpec.ts';
import { analyzeSource, loadAnalysis, persistAnalysis, readSource, type AnalysisSource } from './analysis.routes.ts';
import { ensureAnalysisShareUrl } from './share.routes.ts';

const MAX_TEXT_CHARS = 2_000_000;

/** Удалить осиротевшую загрузку (файл + строка uploads) владельца — компенсация,
 *  когда multipart-запрос сохранил файл, но затем упёрся в 429 на резерве. */
async function deleteApiUpload(db: Db, userId: string, uploadId: string): Promise<void> {
  try {
    const row = (
      await db.query<{ storage: 's3' | 'local' | 'supabase'; storage_key: string }>(
        'SELECT storage, storage_key FROM uploads WHERE id = $1 AND user_id = $2',
        [uploadId, userId],
      )
    ).rows[0];
    if (!row) return;
    await deleteFile(row.storage, row.storage_key).catch(() => undefined);
    await db.query('DELETE FROM uploads WHERE id = $1 AND user_id = $2', [uploadId, userId]);
  } catch {
    /* best-effort — компенсация не должна ронять уже возвращаемую клиенту ошибку */
  }
}

/** 60 запросов в минуту — бёрст-лимит на все /v1-вызовы. Бакет задаёт глобальный
 *  keyGenerator (app.ts): для lxb_-запросов он по IP-адресу источника, не по
 *  ключу — иначе поток случайных ключей с одного хоста обошёл бы лимит. */
const KEY_RATE_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

/** Per-route гвард прав ключа. ПУСТОЙ список скоупов у ключа = без ограничений
 *  (полный доступ, обратная совместимость с ключами до Фазы 3); иначе нужен
 *  ЛЮБОЙ из перечисленных скоупов. Ставится ПОСЛЕ authenticateApiKey. */
function requireScope(...allowed: ApiScope[]) {
  return async (req: FastifyRequest): Promise<void> => {
    const scopes = req.apiKeyScopes ?? [];
    if (scopes.length === 0) return; // ключ без ограничений
    if (allowed.some((s) => scopes.includes(s))) return;
    throw new HttpError(
      403,
      `This API key does not have the required scope (${allowed.map((s) => `"${s}"`).join(' or ')}). Create a key with the right scopes in your Lexab dashboard.`,
      'insufficient_scope',
    );
  };
}

const IDEM_KEY_MAX = 256;

/** SHA-256 присланного Idempotency-Key (сырое значение клиента в БД не храним).
 *  Хеш привязан к КОНКРЕТНОМУ ключу (keyId): у команды все ключи ходят под
 *  user_id владельца и делили бы одно пространство идемпотентности — две
 *  независимые интеграции (напр. два отдела) с наивным ключом 'contract-001'
 *  затирали бы задания друг друга. Пер-ключевой хеш это исключает; повтор тем
 *  же ключом (тот же keyId+значение) по-прежнему дедуплицируется. */
function idemHashFrom(req: FastifyRequest, keyId: string): string | null {
  const h = req.headers['idempotency-key'];
  const v = typeof h === 'string' ? h.trim() : '';
  if (!v) return null;
  if (v.length > IDEM_KEY_MAX) {
    throw new HttpError(400, `Idempotency-Key is too long (max ${IDEM_KEY_MAX} characters).`, 'idempotency_key_invalid');
  }
  return crypto.createHash('sha256').update(`${keyId}\n${v}`).digest('hex');
}

/** Маркер «этот Idempotency-Key уже создал задание» — ловится в роуте. */
class IdempotentReplay extends Error {}

/** Ранее созданное этим Idempotency-Key задание (повтор НЕ списывает юнит и не
 *  создаёт дубль) или null. Тот же ключ на другом виде задания — 409: клиент
 *  явно перепутал ключи, молча вернуть чужой результат было бы хуже. */
async function findIdempotentReplay(
  db: Db,
  userId: string,
  idemHash: string,
  kind: string,
): Promise<Record<string, unknown> | null> {
  const row = (
    await db.query<{ request_id: string; kind: string }>(
      'SELECT request_id, kind FROM api_idempotency WHERE user_id = $1 AND idem_hash = $2',
      [userId, idemHash],
    )
  ).rows[0];
  if (!row) return null;
  if (row.kind !== kind) {
    throw new HttpError(409, 'This Idempotency-Key was already used for a different endpoint. Use a fresh key per logical request.', 'idempotency_key_reused');
  }
  const job = (
    await db.query<ApiRequestRow>(
      'SELECT id, status, file_name, analysis_id, error_code, error_message, created_at FROM api_requests WHERE id = $1 AND user_id = $2',
      [row.request_id, userId],
    )
  ).rows[0];
  if (!job) {
    // Задание вычищено ретеншеном (7-дневный ретеншен api_idempotency короче
    // 90-дневного api_requests, так что это только ручное вмешательство) —
    // честный конфликт вместо тихого создания дубля под тем же ключом.
    throw new HttpError(409, 'The request created with this Idempotency-Key no longer exists. Use a fresh key.', 'idempotency_key_stale');
  }
  const base = baseWire(job);
  // Повтор УПАВШЕГО задания: держим тот же контракт, что и GET (status:'error'
  // всегда с error:{code,message}) — иначе клиент по документации словил бы
  // undefined на r.error.
  if (job.status === 'error') {
    return { ...base, error: { code: job.error_code ?? 'generation_failed', message: job.error_message ?? 'Request failed.' } };
  }
  return base;
}

interface ApiRequestRow {
  id: string;
  status: string;
  file_name: string;
  analysis_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
}

/** Внешний статус: queued не отличим от processing для клиента (оба «в работе»). */
const wireStatus = (s: string): 'processing' | 'done' | 'error' => (s === 'done' || s === 'error' ? s : 'processing');

function baseWire(row: ApiRequestRow) {
  return {
    id: row.id,
    status: wireStatus(row.status),
    fileName: row.file_name,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/**
 * Общий каркас фонового API-задания (analysis/draft/compare/template): атомарный
 * клейм queued→processing, heartbeat раз в минуту, единый разбор ошибки (пометка
 * error под гардом статуса + возврат месячного юнита + аудит). `work(plan)` сам
 * генерирует и помечает задание done — analysis/draft делают это внутри
 * транзакции persistAnalysis (apiRequestId), compare/template одним UPDATE со
 * status+result (см. markResultDone). Текст договора в api_requests не хранится.
 */
async function runApiJob(
  db: Db,
  requestId: string,
  userId: string,
  keyId: string,
  auditType: AuditEventType,
  label: string,
  work: (plan: string) => Promise<void>,
): Promise<void> {
  const claim = await db.query<{ id: string }>(
    "UPDATE api_requests SET status = 'processing', updated_at = now() WHERE id = $1 AND status = 'queued' RETURNING id",
    [requestId],
  );
  if (!claim.rows[0]) return;

  const keepalive = setInterval(() => {
    void db
      .query("UPDATE api_requests SET updated_at = now() WHERE id = $1 AND status = 'processing'", [requestId])
      .catch(() => undefined);
  }, 60_000);
  keepalive.unref?.();

  // kind для события вебхука ('ai.analysis' → 'analysis' и т.д.).
  const kind = auditType.replace(/^ai\./, '');
  try {
    // withAiRequest — тот же учёт ИИ-квоты, что у интерактивного/batch путей.
    await withAiRequest(db, userId, (plan) => work(plan));
    // Задание завершено (done закоммичен работой) → callback клиенту (never-throw).
    await enqueueJobWebhooks(db, userId, requestId, kind, 'done');
  } catch (err) {
    // Гард по статусу: если recovery уже пометил задание прерванным (или work
    // успел проставить done), поздний провал не перетирает статус и не возвращает
    // квоту второй раз.
    const marked = await db.query<{ id: string }>(
      `UPDATE api_requests SET status = 'error', error_code = $2, error_message = $3, updated_at = now()
       WHERE id = $1 AND status = 'processing' RETURNING id`,
      [
        requestId,
        err instanceof HttpError ? (err.code ?? `http_${err.status}`) : 'generation_failed',
        (err instanceof HttpError ? err.message : 'Request failed. Please retry.').slice(0, 300),
      ],
    );
    if (marked.rows[0]) {
      await releaseApiRequest(db, userId).catch(() => undefined);
      await audit(db, null, {
        type: auditType,
        teamOwnerId: userId,
        actorId: userId,
        actorLabel: `api:${keyId}`,
        target: { type: 'api_request', id: requestId, label },
        status: 'error',
        metadata: { feature: 'api', ok: false },
      });
      await enqueueJobWebhooks(db, userId, requestId, kind, 'error');
    }
  } finally {
    clearInterval(keepalive);
  }
}

/** Пометить задание done со своим результатом (compare/template): результат
 *  ШИФРУЕТСЯ at-rest (envelope как document_blocks — может содержать текст
 *  договора). status и result — в одном UPDATE, поэтому «сохранено, но помечено
 *  error» невозможно; гард status='processing' уважает recovery. */
async function markResultDone(db: Db, requestId: string, userId: string, resultObj: unknown): Promise<void> {
  const enc = await encJsonForJsonb(db, userId, resultObj);
  await db.query(
    "UPDATE api_requests SET status = 'done', result = $2, updated_at = now() WHERE id = $1 AND status = 'processing'",
    [requestId, enc],
  );
}

/** Анализ договора: то же ядро analyzeSource → persistAnalysis, что на сайте. */
export async function runApiAnalysis(db: Db, requestId: string, userId: string, keyId: string, source: AnalysisSource): Promise<void> {
  await runApiJob(db, requestId, userId, keyId, 'ai.analysis', source.fileName, async (plan) => {
    const gen = await analyzeSource(db, userId, source, plan);
    // persistAnalysis атомарно помечает api_requests=done по apiRequestId.
    await persistAnalysis(db, userId, source, gen, userId, null, `api:${keyId}`, {
      skipDocQuota: true,
      skipNotify: true,
      apiRequestId: requestId,
    });
  });
}

/** Черновик договора из промпта: ложится на общий persistAnalysis (документ в
 *  кабинете владельца) и атомарно помечает api_requests=done. */
async function runApiDraft(db: Db, requestId: string, userId: string, keyId: string, prompt: string, jurisdiction: string | null): Promise<void> {
  await runApiJob(db, requestId, userId, keyId, 'ai.draft', 'Draft contract', async (plan) => {
    const draft = await generateContractDraft(prompt, jurisdiction, plan);
    const draftText = draft.document
      .map((b) => (b.type === 'heading' ? (b.text ?? '') : (b.segments ?? []).join('')))
      .join('\n\n');
    const sizeBytes = Buffer.byteLength(draftText, 'utf8');
    const gen: GeneratedAnalysis = {
      summary: draft.summary,
      riskScore: 0,
      riskLevel: 'Low',
      clausesReviewed: draft.document.filter((b) => b.type === 'heading').length,
      findings: [],
      redlines: [],
      document: draft.document,
    };
    const source: AnalysisSource = { fileName: draft.title, fileSizeLabel: formatSize(sizeBytes), sizeBytes, text: draftText, pdf: null, jurisdiction };
    await persistAnalysis(db, userId, source, gen, userId, null, `api:${keyId}`, {
      skipDocQuota: true,
      skipNotify: true,
      apiRequestId: requestId,
      // Черновик — генерация, не проверка: не накручиваем ревью-аналитику владельца.
      skipReviewStats: true,
    });
  });
}

/** Сравнение двух версий: результат (с текстом пунктов) шифруется в result. */
async function runApiCompare(db: Db, requestId: string, userId: string, keyId: string, textA: string, textB: string, nameA: string, nameB: string): Promise<void> {
  await runApiJob(db, requestId, userId, keyId, 'ai.compare', `${nameA} ↔ ${nameB}`.slice(0, 300), async (plan) => {
    const result = await generateCompare(textA, textB, nameA, nameB, plan);
    await markResultDone(db, requestId, userId, result);
  });
}

/** Генерация по шаблону: результат { title, content } шифруется в result. */
async function runApiTemplate(db: Db, requestId: string, userId: string, keyId: string, templateName: string, templateDescription: string, fields: TemplateFields): Promise<void> {
  await runApiJob(db, requestId, userId, keyId, 'ai.template', templateName.slice(0, 300), async (plan) => {
    const content = await generateTemplateDraft(templateName, templateDescription, fields, plan);
    await markResultDone(db, requestId, userId, { title: `${templateName} — ${fields.partyA} / ${fields.partyB}`, content });
  });
}

/** Дешёвый предварительный отказ по месячному лимиту ДО дорогой работы. */
async function assertApiLimit(db: Db, userId: string): Promise<void> {
  const pre = await apiMonthlyUsage(db, userId);
  if (pre.limit !== null && pre.used >= pre.limit) {
    throw new HttpError(429, `Monthly API limit reached (${pre.limit}/${pre.limit} this month). The counter resets on the 1st.`, 'monthly_limit_exceeded');
  }
}

/** Атомарно зарезервировать месячный юнит и вставить строку-задание (queued).
 *  При Idempotency-Key строка api_idempotency пишется В ТОЙ ЖЕ транзакции:
 *  конфликт (параллельный повтор успел первым) откатывает и резерв, и задание —
 *  юнит не списывается дважды. Бросает IdempotentReplay — роут возвращает
 *  ранее созданное задание. */
async function insertApiJob(
  db: Db,
  requestId: string,
  userId: string,
  keyId: string,
  kind: string,
  fileName: string,
  idemHash?: string | null,
): Promise<void> {
  await db.withTx(async (tx) => {
    if (idemHash) {
      const ins = await tx.query<{ request_id: string }>(
        `INSERT INTO api_idempotency (user_id, idem_hash, kind, request_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, idem_hash) DO NOTHING RETURNING request_id`,
        [userId, idemHash, kind, requestId],
      );
      if (!ins.rows[0]) throw new IdempotentReplay();
    }
    await reserveApiRequest(tx, userId);
    await tx.query(
      "INSERT INTO api_requests (id, user_id, key_id, kind, file_name, status) VALUES ($1, $2, $3, $4, $5, 'queued')",
      [requestId, userId, keyId, kind, fileName],
    );
  });
}

/** Ответ по compare/template-заданию: расшифровка result или wire-ошибка. */
async function resultJobResponse(db: Db, id: string, userId: string, kind: string, label: string): Promise<Record<string, unknown>> {
  const row = (
    await db.query<ApiRequestRow & { result: unknown }>(
      `SELECT id, status, file_name, analysis_id, error_code, error_message, created_at, result
       FROM api_requests WHERE id = $1 AND user_id = $2 AND kind = $3`,
      [id, userId, kind],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, `${label} not found.`, 'not_found');
  const base = baseWire(row);
  if (row.status === 'error') {
    return { ...base, error: { code: row.error_code ?? 'generation_failed', message: row.error_message ?? 'Request failed.' } };
  }
  if (row.status !== 'done' || row.result == null) return base;
  const result = await decJsonFromJsonb(db, userId, row.result);
  if (!result) return { ...base, status: 'error', error: { code: 'result_unreadable', message: 'The result could not be decrypted.' } };
  return { ...base, ...(result as Record<string, unknown>) };
}

/**
 * Ретеншен журнала API (index.ts, раз в сутки под кластерным локом): терминальные
 * строки (done/error) старше 90 дней уже не нужны — график показывает 30 дней,
 * список отдаёт свежие постранично — поэтому чистим их, чтобы api_requests не рос
 * безгранично. Живые (queued/processing) не трогаем.
 */
export async function pruneApiRequests(db: Db): Promise<void> {
  await db.query(
    "DELETE FROM api_requests WHERE status IN ('done', 'error') AND created_at < now() - interval '90 days'",
  );
  // Идемпотентные ключи короткоживущие: повтор запроса приходит в течение
  // минут/часов; 7 дней хватает с запасом, а таблица не растёт безгранично.
  await db.query("DELETE FROM api_idempotency WHERE created_at < now() - interval '7 days'");
  // Журнал вебхуков платежей: тело уже затирается при обработке, но и сами
  // строки не должны копиться вечно — ретраи LS приходят в пределах суток,
  // 90 дней хватает на любой разбор инцидента (аудит 2026-08-03).
  await db.query("DELETE FROM ls_webhook_events WHERE created_at < now() - interval '90 days'");
}

/**
 * Recovery (index.ts, при старте и раз в 5 минут, под кластерным локом):
 * задания, чей heartbeat молчит 3+ минуты (инстанс умер), честно закрываются
 * ошибкой interrupted с возвратом месячного юнита — клиент видит статус и
 * повторяет запрос. Свежие queued не трогаются: их клейм происходит сразу
 * после INSERT в том же процессе.
 */
export async function failInterruptedApiRequests(db: Db): Promise<void> {
  const orphans = await db.query<{ user_id: string }>(
    `UPDATE api_requests
     SET status = 'error', error_code = 'interrupted',
         error_message = 'Processing was interrupted by a server restart. Please retry.', updated_at = now()
     WHERE status IN ('queued', 'processing') AND updated_at < now() - interval '3 minutes'
     RETURNING user_id`,
  );
  for (const row of orphans.rows) {
    await releaseApiRequest(db, row.user_id).catch(() => undefined);
  }
}

/** Источник анализа из JSON-тела { text, fileName?, jurisdiction? }. */
function sourceFromJson(req: FastifyRequest, requestId: string): AnalysisSource {
  const body = asObject(req.body);
  const text = requireString(body, 'text', { min: 40, max: MAX_TEXT_CHARS });
  const fileName = optionalString(body, 'fileName', { max: 300 })?.trim() || `contract-${requestId.slice(-6)}.txt`;
  const jurisdiction = optionalString(body, 'jurisdiction')?.slice(0, 60) ?? null;
  const sizeBytes = Buffer.byteLength(text, 'utf8');
  return { fileName, fileSizeLabel: formatSize(sizeBytes), sizeBytes, text, pdf: null, jurisdiction, uploadId: null };
}

export function publicApiRoutes(app: FastifyInstance, db: Db): void {
  void app.register(
    async (v1) => {
      // Формат ошибок публичного API: { error: { code, message } }.
      v1.setErrorHandler((err, req, reply) => {
        // Гонка двух одновременных POST с одним Idempotency-Key: проигравший
        // получает 409 и на повторе — ранее созданное задание (precheck).
        if (err instanceof IdempotentReplay) {
          return reply.code(409).send({
            error: { code: 'idempotency_conflict', message: 'A concurrent request with the same Idempotency-Key is in flight. Retry to get the created request.' },
          });
        }
        if (err instanceof HttpError) {
          return reply.code(err.status).send({ error: { code: err.code ?? `http_${err.status}`, message: err.message } });
        }
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 429) {
          return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests — at most 60 per minute per key.' } });
        }
        if (statusCode && statusCode >= 400 && statusCode < 500) {
          return reply.code(statusCode).send({ error: { code: `http_${statusCode}`, message: (err as Error).message } });
        }
        req.log.error(err);
        return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal server error' } });
      });
      v1.setNotFoundHandler((_req, reply) => {
        void reply.code(404).send({ error: { code: 'not_found', message: 'Unknown API route. See the API docs in your Lexab dashboard.' } });
      });

      // OpenAPI 3.1 спека — ПУБЛИЧНАЯ (без ключа): это документация контракта,
      // секретов в ней нет; интеграторы генерируют из неё SDK. Спека статична
      // на время жизни процесса — собираем один раз.
      const openApiSpec = buildOpenApiSpec();
      v1.get('/openapi.json', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => openApiSpec);

      // Создать анализ: multipart `file` (pdf/docx/txt…) ИЛИ JSON { text }.
      v1.post('/analyses', { preHandler: [v1.authenticateApiKey, requireScope('analyses:write')], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const userId = req.currentUser.id;
        const keyId = req.apiKeyId as string;
        const requestId = newId('apireq');

        // Idempotency-Key: повтор того же запроса (ретрай клиента после сетевого
        // сбоя) возвращает РАНЕЕ созданное задание без второго списания.
        const idemHash = idemHashFrom(req, keyId);
        if (idemHash) {
          const replay = await findIdempotentReplay(db, userId, idemHash, 'analysis');
          if (replay) {
            reply.code(202);
            return replay;
          }
        }

        // Дешёвый предварительный отказ ДО дорогого readSource (антивирус,
        // извлечение, сохранение файла): исчерпавший месячный лимит получает
        // 429 сразу. Авторитетный атомарный резерв — в insertApiJob (ловит гонку).
        await assertApiLimit(db, userId);

        // Мультипарт-ветка переиспользует общий readSource (расширения,
        // magic-байты, антивирус, квота хранилища, строка uploads) — API-файлы
        // проходят ровно те же ворота, что и загрузки на сайте.
        const source = req.isMultipart() ? await readSource(db, req) : sourceFromJson(req, requestId);

        const createdAt = new Date().toISOString();
        try {
          await insertApiJob(db, requestId, userId, keyId, 'analysis', source.fileName, idemHash);
        } catch (err) {
          // Гонка на границе лимита: pre-check прошёл, но атомарный резерв поймал
          // 429. Для multipart файл уже сохранён и списан в storage-квоту в
          // readSource — подчищаем его (у JSON-ветки upload'а нет). То же при
          // идемпотентном повторе-гонке: дубль-файл не нужен.
          if (source.uploadId) await deleteApiUpload(db, userId, source.uploadId);
          if (err instanceof IdempotentReplay && idemHash) {
            const replay = await findIdempotentReplay(db, userId, idemHash, 'analysis');
            if (replay) {
              reply.code(202);
              return replay;
            }
          }
          throw err;
        }

        void runApiAnalysis(db, requestId, userId, keyId, source).catch((err) => req.log.error(err, 'api analysis failed'));

        reply.code(202);
        return { id: requestId, status: 'processing', fileName: source.fileName, createdAt };
      });

      // Статус/результат одного анализа. Только свои записи — чужой id = 404.
      // Скоуп: write подразумевает read (иначе создавший ключ не смог бы поллить).
      v1.get('/analyses/:id', { preHandler: [v1.authenticateApiKey, requireScope('analyses:read', 'analyses:write')], config: KEY_RATE_LIMIT }, async (req) => {
        const { id } = req.params as { id: string };
        const res = await db.query<ApiRequestRow>(
          `SELECT id, status, file_name, analysis_id, error_code, error_message, created_at
           FROM api_requests WHERE id = $1 AND user_id = $2 AND kind = 'analysis'`,
          [id, req.currentUser.id],
        );
        const row = res.rows[0];
        if (!row) throw new HttpError(404, 'Analysis not found.', 'not_found');
        const base = baseWire(row);
        if (row.status === 'error') {
          return { ...base, error: { code: row.error_code ?? 'analysis_failed', message: row.error_message ?? 'Analysis failed.' } };
        }
        if (row.status !== 'done' || !row.analysis_id) return base;

        const a = await db.query<{ document_id: string; summary: string; risk_score: number; risk_level: string; clauses_reviewed: number }>(
          'SELECT document_id, summary, risk_score, risk_level, clauses_reviewed FROM analyses WHERE id = $1',
          [row.analysis_id],
        );
        const an = a.rows[0];
        if (!an) return { ...base, status: 'error' as const, error: { code: 'analysis_deleted', message: 'The analysis was deleted from the workspace.' } };
        const findings = await db.query<{ severity: string; title: string; citation: string; unverified: boolean }>(
          'SELECT severity, title, citation, unverified FROM findings WHERE analysis_id = $1 ORDER BY ord',
          [row.analysis_id],
        );
        const summary = await decText(db, req.currentUser.id, an.summary);
        // ?report=1 — вернуть ссылку на страницу-отчёт (для показа человеку).
        const wantReport = ['1', 'true', 'yes'].includes(String((req.query as { report?: string })?.report ?? ''));
        const reportUrl = wantReport ? await ensureAnalysisShareUrl(db, req.currentUser.id, row.analysis_id) : undefined;
        return {
          ...base,
          analysisId: row.analysis_id,
          documentId: an.document_id,
          riskScore: an.risk_score,
          riskLevel: an.risk_level,
          clausesReviewed: an.clauses_reviewed,
          summary: summary ?? '',
          ...(reportUrl ? { reportUrl } : {}),
          findings: findings.rows.map((f) => ({
            severity: f.severity,
            title: f.title,
            citation: f.citation,
            // «Проверено по базе законов»: цитата подтверждена валидатором.
            verified: !f.unverified,
          })),
        };
      });

      // История вызовов (постранично).
      v1.get('/analyses', { preHandler: [v1.authenticateApiKey, requireScope('analyses:read', 'analyses:write')], config: KEY_RATE_LIMIT }, async (req) => {
        const q = (req.query ?? {}) as { limit?: string; offset?: string };
        // Math.trunc: дробные limit/offset (например ?limit=2.5) иначе ушли бы в
        // Postgres как есть и вернули 500 вместо результата.
        const limit = Math.min(Math.max(Math.trunc(Number(q.limit)) || 20, 1), 100);
        const offset = Math.max(Math.trunc(Number(q.offset)) || 0, 0);
        const rows = await db.query<ApiRequestRow & { risk_score: number | null; risk_level: string | null }>(
          `SELECT r.id, r.status, r.file_name, r.analysis_id, r.error_code, r.error_message, r.created_at,
                  a.risk_score, a.risk_level
           FROM api_requests r LEFT JOIN analyses a ON a.id = r.analysis_id
           WHERE r.user_id = $1 AND r.kind = 'analysis' ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
          [req.currentUser.id, limit, offset],
        );
        return {
          items: rows.rows.map((r) => {
            // Анализ мог быть удалён (retention/пользователь): строка done есть,
            // но JOIN пуст → отдаём error, а не done с null-риском.
            const deleted = r.status === 'done' && (!r.analysis_id || r.risk_level === null);
            if (deleted) {
              return { ...baseWire(r), status: 'error' as const, error: { code: 'analysis_deleted', message: 'The analysis was deleted from the workspace.' } };
            }
            return {
              ...baseWire(r),
              ...(r.status === 'done' && r.analysis_id ? { analysisId: r.analysis_id, riskScore: r.risk_score, riskLevel: r.risk_level } : {}),
              ...(r.status === 'error' ? { error: { code: r.error_code ?? 'analysis_failed', message: r.error_message ?? 'Analysis failed.' } } : {}),
            };
          }),
          limit,
          offset,
        };
      });

      // Остаток месячного лимита — интеграторы закладывают его в свою логику.
      v1.get('/usage', { preHandler: [v1.authenticateApiKey], config: KEY_RATE_LIMIT }, async (req) => {
        const { used, limit } = await apiMonthlyUsage(db, req.currentUser.id);
        return {
          month: new Date().toISOString().slice(0, 7),
          used,
          limit,
          remaining: limit === null ? null : Math.max(limit - used, 0),
        };
      });

      // ── Черновик договора из промпта ─────────────────────────────────────
      v1.post('/drafts', { preHandler: [v1.authenticateApiKey, requireScope('drafts:write')], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const userId = req.currentUser.id;
        const keyId = req.apiKeyId as string;
        const body = asObject(req.body);
        const prompt = requireString(body, 'prompt', { min: 1, max: 4000 });
        const jurisdiction = optionalString(body, 'jurisdiction')?.slice(0, 120) || null;
        const idemHash = idemHashFrom(req, keyId);
        if (idemHash) {
          const replay = await findIdempotentReplay(db, userId, idemHash, 'draft');
          if (replay) {
            reply.code(202);
            return replay;
          }
        }
        await assertApiLimit(db, userId);
        const requestId = newId('apireq');
        const createdAt = new Date().toISOString();
        // Нейтральная метка: промпт — свободный текст с деталями сделки, его нельзя
        // класть в file_name открытым текстом (в отличие от шифруемого result).
        const label = 'Draft contract';
        await insertApiJob(db, requestId, userId, keyId, 'draft', label, idemHash);
        void runApiDraft(db, requestId, userId, keyId, prompt, jurisdiction).catch((err) => req.log.error(err, 'api draft failed'));
        reply.code(202);
        return { id: requestId, status: 'processing', fileName: label, createdAt };
      });

      // Черновик: статус + сгенерированный документ (blocks).
      v1.get('/drafts/:id', { preHandler: [v1.authenticateApiKey, requireScope('drafts:write')], config: KEY_RATE_LIMIT }, async (req) => {
        const { id } = req.params as { id: string };
        const row = (
          await db.query<ApiRequestRow>(
            `SELECT id, status, file_name, analysis_id, error_code, error_message, created_at
             FROM api_requests WHERE id = $1 AND user_id = $2 AND kind = 'draft'`,
            [id, req.currentUser.id],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'Draft not found.', 'not_found');
        const base = baseWire(row);
        if (row.status === 'error') return { ...base, error: { code: row.error_code ?? 'generation_failed', message: row.error_message ?? 'Draft failed.' } };
        if (row.status !== 'done' || !row.analysis_id) return base;
        // Черновик хранится как обычный анализ-документ владельца — берём blocks
        // расшифрованными через loadAnalysis (findings/redlines у черновика пусты).
        const a = await loadAnalysis(db, req.currentUser.id, row.analysis_id).catch(() => null);
        if (!a) return { ...base, status: 'error' as const, error: { code: 'draft_deleted', message: 'The draft was deleted from the workspace.' } };
        const wantReport = ['1', 'true', 'yes'].includes(String((req.query as { report?: string })?.report ?? ''));
        const reportUrl = wantReport ? await ensureAnalysisShareUrl(db, req.currentUser.id, row.analysis_id) : undefined;
        return { ...base, fileName: a.fileName, title: a.fileName, summary: a.summary, document: a.document, ...(reportUrl ? { reportUrl } : {}) };
      });

      // ── Сравнение двух версий ────────────────────────────────────────────
      v1.post('/compares', { preHandler: [v1.authenticateApiKey, requireScope('compares:write')], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const userId = req.currentUser.id;
        const keyId = req.apiKeyId as string;
        const idemHash = idemHashFrom(req, keyId);
        if (idemHash) {
          const replay = await findIdempotentReplay(db, userId, idemHash, 'compare');
          if (replay) {
            reply.code(202);
            return replay;
          }
        }
        await assertApiLimit(db, userId);
        let textA: string | null;
        let textB: string | null;
        let nameA: string;
        let nameB: string;
        if (req.isMultipart()) {
          // Два файла читаем В ПАМЯТИ (как /compare), без сохранения в uploads.
          const files: { field: string; name: string; text: string | null }[] = [];
          for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } })) {
            if (part.type !== 'file') continue;
            const name = part.filename || part.fieldname;
            if (!ALLOWED_EXTENSIONS.includes(fileExtension(name))) throw badRequest(`Unsupported file type "${name}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
            const buffer = await part.toBuffer();
            assertValidFileContent(buffer, name);
            files.push({ field: part.fieldname, name, text: await extractText(buffer, name) });
          }
          const a = files.find((f) => f.field === 'fileA') ?? files[0];
          const b = files.find((f) => f.field === 'fileB') ?? files[1];
          if (!a || !b) throw badRequest('Attach both versions: "fileA" (older) and "fileB" (newer).');
          textA = a.text;
          textB = b.text;
          nameA = a.name;
          nameB = b.name;
        } else {
          const body = asObject(req.body);
          textA = requireString(body, 'textA', { min: 40, max: MAX_TEXT_CHARS });
          textB = requireString(body, 'textB', { min: 40, max: MAX_TEXT_CHARS });
          nameA = optionalString(body, 'nameA', { max: 200 })?.trim() || 'Version A';
          nameB = optionalString(body, 'nameB', { max: 200 })?.trim() || 'Version B';
        }
        if (!textA || !textB) throw new HttpError(422, 'Could not read text from one of the files. Use DOCX, TXT or digital PDF (not scans).', 'unreadable_file');
        // Тот же порог длины, что у JSON-ветки (requireString min 40) — короткий
        // файл иначе списал бы юнит и прогнал модель на бессмыслице.
        if (textA.trim().length < 40 || textB.trim().length < 40) {
          throw new HttpError(422, 'Each version must contain at least 40 characters of contract text.', 'text_too_short');
        }
        const requestId = newId('apireq');
        const createdAt = new Date().toISOString();
        const label = `${nameA} ↔ ${nameB}`.slice(0, 300);
        await insertApiJob(db, requestId, userId, keyId, 'compare', label, idemHash);
        void runApiCompare(db, requestId, userId, keyId, textA, textB, nameA, nameB).catch((err) => req.log.error(err, 'api compare failed'));
        reply.code(202);
        return { id: requestId, status: 'processing', fileName: label, createdAt };
      });

      v1.get('/compares/:id', { preHandler: [v1.authenticateApiKey, requireScope('compares:write')], config: KEY_RATE_LIMIT }, async (req) => {
        const { id } = req.params as { id: string };
        return resultJobResponse(db, id, req.currentUser.id, 'compare', 'Comparison');
      });

      // ── Шаблоны договоров ────────────────────────────────────────────────
      v1.get('/templates', { preHandler: [v1.authenticateApiKey], config: KEY_RATE_LIMIT }, async () => {
        const rows = await db.query<{ id: string; name: string; nameRu: string | null; category: string; description: string; jurisdiction: string | null }>(
          'SELECT id, name, name_ru AS "nameRu", category, description, jurisdiction FROM templates ORDER BY category, name',
        );
        return { items: rows.rows };
      });

      v1.post('/templates/:id/generate', { preHandler: [v1.authenticateApiKey, requireScope('templates:write')], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const userId = req.currentUser.id;
        const keyId = req.apiKeyId as string;
        const { id } = req.params as { id: string };
        const tpl = (
          await db.query<{ id: string; name: string; description: string; jurisdiction: string | null }>(
            'SELECT id, name, description, jurisdiction FROM templates WHERE id = $1',
            [id],
          )
        ).rows[0];
        if (!tpl) throw new HttpError(404, 'Template not found.', 'not_found');
        const body = asObject(req.body);
        const fields: TemplateFields = {
          partyA: requireString(body, 'partyA', { min: 1, max: 200 }),
          partyB: requireString(body, 'partyB', { min: 1, max: 200 }),
          jurisdiction: optionalString(body, 'jurisdiction')?.trim() || tpl.jurisdiction || '',
          term: optionalString(body, 'term')?.trim() || '',
          details: requireString(body, 'details', { min: 5, max: 4000 }),
        };
        const idemHash = idemHashFrom(req, keyId);
        if (idemHash) {
          const replay = await findIdempotentReplay(db, userId, idemHash, 'template');
          if (replay) {
            reply.code(202);
            return replay;
          }
        }
        await assertApiLimit(db, userId);
        const requestId = newId('apireq');
        const createdAt = new Date().toISOString();
        const label = tpl.name.slice(0, 300);
        await insertApiJob(db, requestId, userId, keyId, 'template', label, idemHash);
        void runApiTemplate(db, requestId, userId, keyId, tpl.name, tpl.description, fields).catch((err) => req.log.error(err, 'api template failed'));
        reply.code(202);
        return { id: requestId, status: 'processing', fileName: label, createdAt };
      });

      v1.get('/templates/requests/:id', { preHandler: [v1.authenticateApiKey, requireScope('templates:write')], config: KEY_RATE_LIMIT }, async (req) => {
        const { id } = req.params as { id: string };
        return resultJobResponse(db, id, req.currentUser.id, 'template', 'Template request');
      });

      // ── Callback-вебхуки: уведомлять систему клиента о завершении заданий ──
      v1.post('/webhooks', { preHandler: [v1.authenticateApiKey, requireScope('webhooks:manage')], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const body = asObject(req.body);
        const url = requireString(body, 'url', { min: 1, max: 2000 });
        const events = Array.isArray(body.events)
          ? (body.events as unknown[]).filter((e): e is string => typeof e === 'string').slice(0, 20)
          : [];
        // createWebhookEndpoint валидирует URL (SSRF: https + публичный IP) и
        // бросит 400, если небезопасен. Секрет подписи возвращается ОДИН раз.
        const ep = await createWebhookEndpoint(db, req.currentUser.id, req.apiKeyId ?? null, url, events);
        reply.code(201);
        return { id: ep.id, events: ep.events, signingSecret: ep.secret };
      });

      v1.get('/webhooks', { preHandler: [v1.authenticateApiKey, requireScope('webhooks:manage')], config: KEY_RATE_LIMIT }, async (req) => {
        return { items: await listWebhookEndpoints(db, req.currentUser.id) };
      });

      v1.delete('/webhooks/:id', { preHandler: [v1.authenticateApiKey, requireScope('webhooks:manage')], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const okDel = await revokeWebhookEndpoint(db, req.currentUser.id, id);
        if (!okDel) throw new HttpError(404, 'Webhook not found.', 'not_found');
        reply.code(204);
      });
    },
    { prefix: '/v1' },
  );
}
