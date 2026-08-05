/**
 * Учёт расхода токенов на ИИ — по пользователю, по операции, по модели.
 *
 * До аудита 2026-08-03 расход НИГДЕ не сохранялся: `[llm] …, in 1200 / out 800`
 * уходил в stdout и исчезал. Ни ответа на «кто сжёг деньги в этом месяце», ни
 * возможности заметить аномалию, ни исторической динамики — при том, что ИИ
 * это главная статья расходов продукта.
 *
 * Устройство:
 *  - userId берётся из AsyncLocalStorage, заведённого на каждый HTTP-запрос
 *    (app.ts), — иначе пришлось бы протаскивать его через все ~12 вызовов
 *    модели и все фоновые задачи;
 *  - запись асинхронная и «best effort»: сбой журнала НИКОГДА не роняет
 *    пользовательский запрос (ровно как в lib/audit.ts).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from '../db.ts';

export interface AiRequestContext {
  /** Кому относить расход; null — фоновая задача без пользователя. */
  userId: string | null;
}

export const aiContext = new AsyncLocalStorage<AiRequestContext>();

export interface LlmUsageRow {
  op: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

let sink: Db | null = null;

/** Подключить журнал (вызывается один раз при сборке приложения). */
export function setLlmUsageDb(db: Db): void {
  sink = db;
}

/** Записать расход токенов. Никогда не бросает и никого не ждёт. */
export function recordLlmUsage(row: LlmUsageRow): void {
  const db = sink;
  if (!db) return;
  const userId = aiContext.getStore()?.userId ?? null;
  void db
    .query(
      `INSERT INTO llm_usage (user_id, op, model, input_tokens, output_tokens, cache_read_tokens)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, row.op.slice(0, 40), row.model.slice(0, 80), row.inputTokens, row.outputTokens, row.cacheReadTokens ?? 0],
    )
    .catch(() => {
      /* журнал расхода не критичен для запроса — молча пропускаем */
    });
}

/** Расход токенов пользователя за текущий месяц (для /billing/limits). */
export async function monthlyTokenUsage(db: Db, userId: string): Promise<{ input: number; output: number }> {
  const res = await db.query<{ input_tokens: string | number; output_tokens: string | number }>(
    `SELECT coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(output_tokens), 0) AS output_tokens
       FROM llm_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
    [userId],
  );
  return { input: Number(res.rows[0]?.input_tokens ?? 0), output: Number(res.rows[0]?.output_tokens ?? 0) };
}

/** Чистка журнала: годовой истории с запасом хватает для аналитики расходов. */
export async function pruneLlmUsage(db: Db): Promise<void> {
  await db.query("DELETE FROM llm_usage WHERE created_at < now() - interval '400 days'");
}
