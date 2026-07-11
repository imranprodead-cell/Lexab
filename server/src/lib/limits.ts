/**
 * Plan-limit enforcement backed by monthly usage COUNTERS (usage_counters):
 * counters only ever grow within a month, so deleting documents or chats
 * does NOT free up quota. AI endpoints call the assert* helpers BEFORE doing
 * any work, and bump* helpers after the work is persisted.
 */
import type { Db, Queryable } from '../db.ts';
import { HttpError } from './errors.ts';

/** null = unlimited. Mirrors the Plans page. */
export const PLAN_LIMITS: Record<string, { ai: number | null; docs: number | null; storageMb: number | null }> = {
  Free: { ai: 10, docs: 3, storageMb: 100 },
  Standard: { ai: 100, docs: 20, storageMb: 2 * 1024 },
  Pro: { ai: null, docs: 80, storageMb: 50 * 1024 },
  Business: { ai: null, docs: 700, storageMb: 1024 * 1024 },
  Enterprise: { ai: null, docs: null, storageMb: null },
};

export async function planFor(db: Db, userId: string): Promise<string> {
  const res = await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId]);
  return res.rows[0]?.plan ?? 'Free';
}

export interface MonthlyUsage {
  aiRequests: number;
  docsCreated: number;
}

/** Current-month counters (0 when the row doesn't exist yet). */
export async function monthlyUsage(db: Db, userId: string): Promise<MonthlyUsage> {
  const res = await db.query<{ ai_requests: number | string; docs_created: number | string }>(
    `SELECT ai_requests, docs_created FROM usage_counters
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [userId],
  );
  const row = res.rows[0];
  return {
    aiRequests: Number(row?.ai_requests ?? 0),
    docsCreated: Number(row?.docs_created ?? 0),
  };
}

/** Increment this month's counters (called AFTER the work is persisted). */
export async function bumpUsage(db: Queryable, userId: string, delta: { ai?: number; docs?: number }): Promise<void> {
  await db.query(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
     VALUES ($1, date_trunc('month', now())::date, $2, $3)
     ON CONFLICT (user_id, month)
     DO UPDATE SET ai_requests = usage_counters.ai_requests + $2,
                   docs_created = usage_counters.docs_created + $3`,
    [userId, delta.ai ?? 0, delta.docs ?? 0],
  );
}

/** Total bytes currently stored (storage CAN be freed by deleting). */
export async function storageUsedBytes(db: Db, userId: string): Promise<number> {
  return Number(
    (
      await db.query<{ sum: string | number | null }>(
        'SELECT coalesce(sum(size_bytes), 0) AS sum FROM uploads WHERE user_id = $1',
        [userId],
      )
    ).rows[0]?.sum ?? 0,
  );
}

const upgradeHint = 'Обновите план в разделе «Тарифы» / Upgrade your plan on the Plans page.';

/** Feature gates — exactly what each plan's card promises, no more, no less.
 *  Cloud integrations (Google Drive / M365 / Dropbox) are open to EVERY plan. */
export type PlanFeature = 'docxExport' | 'templates' | 'compare' | 'signatures' | 'versions' | 'approvals' | 'team';

const FEATURE_MIN_PLAN: Record<PlanFeature, string[]> = {
  docxExport: ['Standard', 'Pro', 'Business', 'Enterprise'],
  templates: ['Standard', 'Pro', 'Business', 'Enterprise'],
  compare: ['Pro', 'Business', 'Enterprise'],
  signatures: ['Pro', 'Business', 'Enterprise'],
  versions: ['Pro', 'Business', 'Enterprise'],
  approvals: ['Pro', 'Business', 'Enterprise'],
  team: ['Business', 'Enterprise'],
};

const FEATURE_LABEL: Record<PlanFeature, { ru: string; en: string; plans: string }> = {
  docxExport: { ru: 'Экспорт в DOCX', en: 'DOCX export', plans: 'Standard, Pro и Business' },
  templates: { ru: 'Генератор договоров', en: 'Contract generator', plans: 'Standard, Pro и Business' },
  compare: { ru: 'Сравнение версий (Redline)', en: 'Version compare (Redline)', plans: 'Pro и Business' },
  signatures: { ru: 'Электронная подпись', en: 'E-signatures', plans: 'Pro и Business' },
  versions: { ru: 'История версий', en: 'Version history', plans: 'Pro и Business' },
  approvals: { ru: 'Маршруты согласования', en: 'Approval workflows', plans: 'Pro и Business' },
  team: { ru: 'Команды и общие документы', en: 'Teams & shared documents', plans: 'Business' },
};

export function planHasFeature(plan: string, feature: PlanFeature): boolean {
  return FEATURE_MIN_PLAN[feature].includes(plan);
}

/** 402 when the user's plan does not include the feature. */
export async function assertFeature(db: Db, userId: string, feature: PlanFeature): Promise<void> {
  const plan = await planFor(db, userId);
  if (planHasFeature(plan, feature)) return;
  const f = FEATURE_LABEL[feature];
  throw new HttpError(
    402,
    `«${f.ru}» доступно на планах ${f.plans} (у вас ${plan}). ${upgradeHint}`,
  );
}

/**
 * Atomically reserve ONE AI request for this month, rejecting (402) when the
 * plan limit is already reached. The increment-if-under-limit runs as a single
 * SQL statement, so concurrent requests can't both slip past a check-then-bump
 * gap (the old TOCTOU). Returns the plan and whether a unit was actually
 * reserved — unlimited plans don't reserve and are counted post-hoc instead.
 * Pair every `reserved: true` with `releaseAiRequest` if the work then fails.
 */
export async function reserveAiRequest(db: Db, userId: string): Promise<{ plan: string; reserved: boolean }> {
  const plan = await planFor(db, userId);
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).ai;
  if (limit === null) return { plan, reserved: false };
  const res = await db.query<{ ai_requests: number | string }>(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
     VALUES ($1, date_trunc('month', now())::date, 1, 0)
     ON CONFLICT (user_id, month)
     DO UPDATE SET ai_requests = usage_counters.ai_requests + 1
       WHERE usage_counters.ai_requests < $2
     RETURNING ai_requests`,
    [userId, limit],
  );
  if (res.rows.length === 0) {
    throw new HttpError(
      402,
      `Лимит ИИ-запросов тарифа ${plan} исчерпан (${limit}/${limit} в этом месяце). ${upgradeHint}`,
    );
  }
  return { plan, reserved: true };
}

/** Give a reserved AI unit back when the work failed (never drops below zero). */
export async function releaseAiRequest(db: Db, userId: string): Promise<void> {
  await db.query(
    `UPDATE usage_counters SET ai_requests = GREATEST(ai_requests - 1, 0)
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [userId],
  );
}

/**
 * Run AI work with an atomic monthly reservation: reserve → work → on success
 * count unlimited plans post-hoc (limited plans were already counted by the
 * reservation); on failure, release the reservation so a failed/unavailable
 * model never consumes the user's allowance.
 */
export async function withAiRequest<T>(db: Db, userId: string, work: (plan: string) => Promise<T>): Promise<T> {
  const { plan, reserved } = await reserveAiRequest(db, userId);
  try {
    const result = await work(plan);
    if (!reserved) await bumpUsage(db, userId, { ai: 1 });
    return result;
  } catch (err) {
    if (reserved) await releaseAiRequest(db, userId);
    throw err;
  }
}

/** 402 when creating one more document would exceed the monthly quota. */
export async function assertDocumentAllowance(db: Db, userId: string): Promise<void> {
  const plan = await planFor(db, userId);
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).docs;
  if (limit === null) return;
  const { docsCreated } = await monthlyUsage(db, userId);
  if (docsCreated >= limit) {
    throw new HttpError(
      402,
      `Лимит документов тарифа ${plan} исчерпан (${docsCreated}/${limit} в этом месяце). ${upgradeHint}`,
    );
  }
}

/** 402 when the incoming file would push stored bytes past the plan quota. */
export async function assertStorageAllowance(db: Db, userId: string, incomingBytes: number): Promise<void> {
  const plan = await planFor(db, userId);
  const limitMb = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).storageMb;
  if (limitMb === null) return;
  const used = await storageUsedBytes(db, userId);
  if (used + incomingBytes > limitMb * 1024 * 1024) {
    const usedMb = Math.round(used / (1024 * 1024));
    throw new HttpError(
      402,
      `Хранилище тарифа ${plan} заполнено (${usedMb} из ${limitMb} МБ). ${upgradeHint}`,
    );
  }
}
