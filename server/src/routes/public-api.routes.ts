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
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { decText } from '../lib/docCrypto.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { apiMonthlyUsage, releaseApiRequest, reserveApiRequest, withAiRequest } from '../lib/limits.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import { deleteFile } from '../storage.ts';
import { analyzeSource, persistAnalysis, readSource, type AnalysisSource } from './analysis.routes.ts';

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

const MAX_TEXT_CHARS = 2_000_000;

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
 * Фоновый прогон одного API-задания. Источник живёт в памяти замыкания (текст
 * договора в api_requests НЕ хранится) — упавший инстанс оставляет строку
 * осиротевшей, её честно закрывает failInterruptedApiRequests. Клейм атомарный
 * (queued → processing), heartbeat раз в минуту — как у batch.
 */
export async function runApiAnalysis(db: Db, requestId: string, userId: string, keyId: string, source: AnalysisSource): Promise<void> {
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

  try {
    // withAiRequest — тот же учёт ИИ-квоты, что у интерактивного и batch-путей
    // (Business безлимитен по счётчику — считается пост-фактум для аналитики).
    // persistAnalysis атомарно помечает api_requests=done ВНУТРИ своей транзакции
    // (apiRequestId), поэтому отдельного done-UPDATE тут нет — успешный анализ
    // не может быть помечен error/возвращён по квоте из-за сбоя поздней записи.
    await withAiRequest(db, userId, async (plan) => {
      const gen = await analyzeSource(db, userId, source, plan);
      return persistAnalysis(db, userId, source, gen, userId, null, `api:${keyId}`, {
        skipDocQuota: true,
        skipNotify: true,
        apiRequestId: requestId,
      });
    });
  } catch (err) {
    // Гард по статусу: если recovery уже пометил задание прерванным, поздний
    // провал не перетирает его и не возвращает квоту второй раз.
    const marked = await db.query<{ id: string }>(
      `UPDATE api_requests SET status = 'error', error_code = $2, error_message = $3, updated_at = now()
       WHERE id = $1 AND status = 'processing' RETURNING id`,
      [
        requestId,
        err instanceof HttpError ? (err.code ?? `http_${err.status}`) : 'analysis_failed',
        (err instanceof HttpError ? err.message : 'Analysis failed. Please retry.').slice(0, 300),
      ],
    );
    if (marked.rows[0]) {
      await releaseApiRequest(db, userId).catch(() => undefined);
      await audit(db, null, {
        type: 'ai.analysis',
        teamOwnerId: userId,
        actorId: userId,
        actorLabel: `api:${keyId}`,
        target: { type: 'api_request', id: requestId, label: source.fileName },
        status: 'error',
        metadata: { feature: 'api', ok: false },
      });
    }
  } finally {
    clearInterval(keepalive);
  }
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

      // Создать анализ: multipart `file` (pdf/docx/txt…) ИЛИ JSON { text }.
      v1.post('/analyses', { preHandler: [v1.authenticateApiKey], config: KEY_RATE_LIMIT }, async (req, reply) => {
        const userId = req.currentUser.id;
        const keyId = req.apiKeyId as string;
        const requestId = newId('apireq');

        // Дешёвый предварительный отказ ДО дорогого readSource (антивирус,
        // извлечение, сохранение файла): исчерпавший месячный лимит получает
        // 429 сразу, не тратя storage/compute. Не атомарно — авторитетный
        // атомарный резерв идёт ниже в транзакции (ловит гонку).
        const pre = await apiMonthlyUsage(db, userId);
        if (pre.limit !== null && pre.used >= pre.limit) {
          throw new HttpError(429, `Monthly API limit reached (${pre.limit}/${pre.limit} analyses this month). The counter resets on the 1st.`, 'monthly_limit_exceeded');
        }

        // Мультипарт-ветка переиспользует общий readSource (расширения,
        // magic-байты, антивирус, квота хранилища, строка uploads) — API-файлы
        // проходят ровно те же ворота, что и загрузки на сайте.
        const source = req.isMultipart() ? await readSource(db, req) : sourceFromJson(req, requestId);

        // Резерв месячного юнита И вставка строки-задания — в ОДНОЙ транзакции:
        // если INSERT откатится, откатится и инкремент счётчика (юнит нельзя
        // потерять или вернуть дважды). 429 из reserveApiRequest тоже откатывает.
        const createdAt = new Date().toISOString();
        try {
          await db.withTx(async (tx) => {
            await reserveApiRequest(tx, userId);
            await tx.query(
              "INSERT INTO api_requests (id, user_id, key_id, file_name, status) VALUES ($1, $2, $3, $4, 'queued')",
              [requestId, userId, keyId, source.fileName],
            );
          });
        } catch (err) {
          // Гонка на границе лимита: pre-check прошёл, но атомарный резерв поймал
          // 429. Для multipart файл уже сохранён и списан в storage-квоту в
          // readSource — подчищаем его, иначе отклонённый вызов навсегда съел бы
          // storage владельца (у JSON-ветки upload'а нет).
          if (source.uploadId) await deleteApiUpload(db, userId, source.uploadId);
          throw err;
        }

        void runApiAnalysis(db, requestId, userId, keyId, source).catch((err) => req.log.error(err, 'api analysis failed'));

        reply.code(202);
        return { id: requestId, status: 'processing', fileName: source.fileName, createdAt };
      });

      // Статус/результат одного анализа. Только свои записи — чужой id = 404.
      v1.get('/analyses/:id', { preHandler: [v1.authenticateApiKey], config: KEY_RATE_LIMIT }, async (req) => {
        const { id } = req.params as { id: string };
        const res = await db.query<ApiRequestRow>(
          `SELECT id, status, file_name, analysis_id, error_code, error_message, created_at
           FROM api_requests WHERE id = $1 AND user_id = $2`,
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
        return {
          ...base,
          analysisId: row.analysis_id,
          documentId: an.document_id,
          riskScore: an.risk_score,
          riskLevel: an.risk_level,
          clausesReviewed: an.clauses_reviewed,
          summary: summary ?? '',
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
      v1.get('/analyses', { preHandler: [v1.authenticateApiKey], config: KEY_RATE_LIMIT }, async (req) => {
        const q = (req.query ?? {}) as { limit?: string; offset?: string };
        // Math.trunc: дробные limit/offset (например ?limit=2.5) иначе ушли бы в
        // Postgres как есть и вернули 500 вместо результата.
        const limit = Math.min(Math.max(Math.trunc(Number(q.limit)) || 20, 1), 100);
        const offset = Math.max(Math.trunc(Number(q.offset)) || 0, 0);
        const rows = await db.query<ApiRequestRow & { risk_score: number | null; risk_level: string | null }>(
          `SELECT r.id, r.status, r.file_name, r.analysis_id, r.error_code, r.error_message, r.created_at,
                  a.risk_score, a.risk_level
           FROM api_requests r LEFT JOIN analyses a ON a.id = r.analysis_id
           WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
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
    },
    { prefix: '/v1' },
  );
}
