/**
 * Массовый разбор (Этап 3) — пачка договоров одним заданием.
 *
 * Файлы заранее загружены через POST /uploads (переиспользуем хранилище,
 * шифрование, извлечение текста, проверку сигнатуры). POST /batch принимает
 * список uploadId, создаёт задание и в фоне прогоняет каждый файл через общий
 * конвейер анализа (analyzeSource → persistAnalysis) — по одному, best-effort:
 * битый/сверхлимитный файл помечается ошибкой, остальные продолжают. Прогресс —
 * поллингом GET /batch/:id (не SSE: проще и без багов стриминга). Каждый готовый
 * анализ — обычная строка в documents/analyses → попадает в «Документы», CLM и
 * аналитику автоматически.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { fileExtension } from '../extract.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { decTextStrict } from '../lib/docCrypto.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature, withAiRequest } from '../lib/limits.ts';
import { asObject } from '../lib/validate.ts';
import { readFileBytes } from '../storage.ts';
import { analyzeSource, persistAnalysis, type AnalysisSource } from './analysis.routes.ts';

const MAX_BATCH_FILES = 20;

interface BatchItemWire {
  id: string;
  fileName: string;
  status: string;
  documentId: string | null;
  analysisId: string | null;
  riskScore: number | null;
  riskLevel: string | null;
  findingsCount: number | null;
  error: string | null;
}

interface BatchJobWire {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  items?: BatchItemWire[];
}

interface JobRow {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  created_at: Date | string;
}

interface ItemRow {
  id: string;
  file_name: string;
  status: string;
  document_id: string | null;
  analysis_id: string | null;
  risk_score: number | null;
  risk_level: string | null;
  findings_count: number | null;
  error: string | null;
}

function jobToWire(row: JobRow): BatchJobWire {
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    done: row.done,
    failed: row.failed,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function itemToWire(row: ItemRow): BatchItemWire {
  return {
    id: row.id,
    fileName: row.file_name,
    status: row.status,
    documentId: row.document_id,
    analysisId: row.analysis_id,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    findingsCount: row.findings_count,
    error: row.error,
  };
}

/** Resolve one uploaded file's content by id (owned by the user). Mirrors the
 *  single-analysis resolver: a PRESENT-but-undecryptable value fails loud. */
async function resolveUploadById(
  db: Db,
  userId: string,
  uploadId: string,
): Promise<{ fileName: string; text: string | null; pdf: Buffer | null; sizeBytes: number } | null> {
  const res = await db.query<{ file_name: string; storage: 's3' | 'local' | 'supabase'; storage_key: string; extracted_text: string | null; size_bytes: number }>(
    'SELECT file_name, storage, storage_key, extracted_text, size_bytes FROM uploads WHERE id = $1 AND user_id = $2',
    [uploadId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  let pdf: Buffer | null = null;
  if (fileExtension(row.file_name) === '.pdf') {
    try {
      pdf = await readFileBytes(row.storage, row.storage_key);
    } catch (err) {
      if (err instanceof Error && /decrypt|DATA_ENCRYPTION|integrity/i.test(err.message)) throw err;
      pdf = null;
    }
  }
  const text = row.extracted_text === null ? null : await decTextStrict(db, userId, row.extracted_text);
  return { fileName: row.file_name, text, pdf, sizeBytes: Number(row.size_bytes) };
}

/** Keep the job's counters and status in sync with its items. Recomputed from
 *  batch_items (not incremented) so it stays correct under a re-run/atomic-claim. */
async function syncJob(db: Db, jobId: string): Promise<void> {
  await db.query(
    `UPDATE batch_jobs SET
       done = (SELECT count(*) FROM batch_items WHERE batch_id = $1 AND status = 'done'),
       failed = (SELECT count(*) FROM batch_items WHERE batch_id = $1 AND status = 'error'),
       status = CASE WHEN (SELECT count(*) FROM batch_items WHERE batch_id = $1 AND status IN ('queued', 'processing')) = 0
                     THEN 'done' ELSE 'processing' END,
       updated_at = now()
     WHERE id = $1`,
    [jobId],
  );
}

/**
 * Process every queued item of a job, sequentially. Each item is claimed
 * atomically (queued → processing), so a stray double-invocation can't
 * double-analyse a file. Exported for deterministic tests (BATCH_AUTOSTART=0).
 */
export async function runBatch(db: Db, jobId: string): Promise<void> {
  const job = await db.query<{ user_id: string; jurisdiction: string | null }>(
    'SELECT user_id, jurisdiction FROM batch_jobs WHERE id = $1',
    [jobId],
  );
  const owner = job.rows[0];
  if (!owner) return;
  await db.query("UPDATE batch_jobs SET status = 'processing', updated_at = now() WHERE id = $1", [jobId]);

  const items = await db.query<{ id: string; upload_id: string | null; file_name: string }>(
    "SELECT id, upload_id, file_name FROM batch_items WHERE batch_id = $1 AND status = 'queued' ORDER BY ord",
    [jobId],
  );

  for (const item of items.rows) {
    // Atomic claim — skip if another runner already took this item.
    const claim = await db.query<{ id: string }>(
      "UPDATE batch_items SET status = 'processing' WHERE id = $1 AND status = 'queued' RETURNING id",
      [item.id],
    );
    if (!claim.rows[0]) continue;

    try {
      if (!item.upload_id) throw new HttpError(400, 'Файл не найден среди загрузок');
      const content = await resolveUploadById(db, owner.user_id, item.upload_id);
      if (!content) throw new HttpError(404, 'Загрузка не найдена или удалена');

      const source: AnalysisSource = {
        fileName: content.fileName,
        fileSizeLabel: formatSize(content.sizeBytes),
        sizeBytes: content.sizeBytes,
        text: content.text,
        pdf: content.pdf,
        jurisdiction: owner.jurisdiction,
        uploadId: item.upload_id,
      };
      // One AI unit per file (same quota as the interactive path); a rejected
      // reservation or a failed model releases it and surfaces here as an error.
      const result = await withAiRequest(db, owner.user_id, async (plan) => {
        const gen = await analyzeSource(db, owner.user_id, source, plan);
        return persistAnalysis(db, owner.user_id, source, gen, owner.user_id);
      });
      await db.query(
        `UPDATE batch_items SET status = 'done', document_id = $2, analysis_id = $3,
                risk_score = $4, risk_level = $5, findings_count = $6, error = NULL WHERE id = $1`,
        [item.id, result.documentId, result.id, result.riskScore, result.riskLevel, result.findings.length],
      );
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Не удалось разобрать файл';
      await db.query("UPDATE batch_items SET status = 'error', error = $2 WHERE id = $1", [item.id, message.slice(0, 300)]);
    }
    await syncJob(db, jobId);
  }
  await syncJob(db, jobId);
}

/**
 * Boot recovery (однократно при старте, index.ts): элементы, оставшиеся в
 * 'processing' после падения/перезапуска, честно помечаются ошибкой
 * «прервано», после чего задания с очередью дорабатываются, а полупустые —
 * финализируются (syncJob выставит итоговый статус). Один инстанс (PM2) —
 * на момент старта другой обработки нет.
 */
export async function resumeBatchJobs(db: Db): Promise<void> {
  await db.query(
    "UPDATE batch_items SET status = 'error', error = 'Прервано перезапуском сервера' WHERE status = 'processing'",
  );
  const jobs = await db.query<{ id: string }>("SELECT id FROM batch_jobs WHERE status IN ('queued', 'processing')");
  for (const job of jobs.rows) {
    await runBatch(db, job.id).catch(() => undefined);
  }
}

export function batchRoutes(app: FastifyInstance, db: Db): void {
  // Start a batch from already-uploaded files.
  app.post('/batch', { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<BatchJobWire> => {
    await assertFeature(db, req.currentUser.id, 'batch');
    const body = asObject(req.body);
    const raw = body.uploadIds;
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('Поле "uploadIds" — непустой массив id загрузок');
    if (raw.length > MAX_BATCH_FILES) throw badRequest(`Слишком много файлов за раз (максимум ${MAX_BATCH_FILES})`);
    const uploadIds: string[] = [];
    for (const u of raw) {
      if (typeof u !== 'string' || !u.trim()) throw badRequest('Каждый uploadId — непустая строка');
      if (!uploadIds.includes(u)) uploadIds.push(u);
    }
    const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 60) : null;

    // Keep only uploads that exist AND belong to the caller — no cross-tenant ids.
    const owned = await db.query<{ id: string; file_name: string }>(
      'SELECT id, file_name FROM uploads WHERE id = ANY($1::text[]) AND user_id = $2',
      [uploadIds, req.currentUser.id],
    );
    const nameById = new Map(owned.rows.map((r) => [r.id, r.file_name]));
    const valid = uploadIds.filter((id) => nameById.has(id));
    if (!valid.length) throw badRequest('Не найдено ни одной вашей загрузки по переданным id');

    const jobId = newId('bat');
    await db.withTx(async (tx) => {
      await tx.query('INSERT INTO batch_jobs (id, user_id, jurisdiction, status, total) VALUES ($1, $2, $3, $4, $5)', [
        jobId,
        req.currentUser.id,
        jurisdiction,
        'queued',
        valid.length,
      ]);
      for (let i = 0; i < valid.length; i++) {
        await tx.query('INSERT INTO batch_items (id, batch_id, ord, file_name, upload_id, status) VALUES ($1, $2, $3, $4, $5, $6)', [
          newId('bi'),
          jobId,
          i,
          nameById.get(valid[i]),
          valid[i],
          'queued',
        ]);
      }
    });

    // Fire-and-forget background processing (disabled in tests, which drive
    // runBatch() explicitly). Analysis is idempotent-per-item via atomic claim.
    if (config.batchAutostart) void runBatch(db, jobId).catch((err) => req.log.error(err, 'batch processing failed'));

    reply.code(201);
    const created = await db.query<JobRow>('SELECT id, status, total, done, failed, created_at FROM batch_jobs WHERE id = $1', [jobId]);
    return jobToWire(created.rows[0]);
  });

  // Job list (no items) — the /batch history table.
  app.get('/batch', { preHandler: [app.authenticate] }, async (req): Promise<BatchJobWire[]> => {
    await assertFeature(db, req.currentUser.id, 'batch');
    const res = await db.query<JobRow>(
      'SELECT id, status, total, done, failed, created_at FROM batch_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.currentUser.id],
    );
    return res.rows.map(jobToWire);
  });

  // One job with its items — polled by the frontend for progress.
  app.get('/batch/:id', { preHandler: [app.authenticate] }, async (req): Promise<BatchJobWire> => {
    await assertFeature(db, req.currentUser.id, 'batch');
    const { id } = req.params as { id: string };
    const jobRes = await db.query<JobRow & { user_id: string }>(
      'SELECT id, user_id, status, total, done, failed, created_at FROM batch_jobs WHERE id = $1',
      [id],
    );
    const job = jobRes.rows[0];
    if (!job || job.user_id !== req.currentUser.id) throw notFound('Задание не найдено');
    const itemsRes = await db.query<ItemRow>(
      `SELECT id, file_name, status, document_id, analysis_id, risk_score, risk_level, findings_count, error
       FROM batch_items WHERE batch_id = $1 ORDER BY ord`,
      [id],
    );
    return { ...jobToWire(job), items: itemsRes.rows.map(itemToWire) };
  });
}
