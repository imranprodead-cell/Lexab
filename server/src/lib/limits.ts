/**
 * Plan-limit enforcement backed by monthly usage COUNTERS (usage_counters):
 * counters only ever grow within a month, so deleting documents or chats
 * does NOT free up quota. AI endpoints call the assert* helpers BEFORE doing
 * any work, and bump* helpers after the work is persisted.
 */
import { config } from '../config.ts';
import type { Db, Queryable } from '../db.ts';
import { HttpError } from './errors.ts';
import { activeTeamOwnerFor } from './teamAccess.ts';

/**
 * null = unlimited. Mirrors the Plans page.
 *
 * ai — месячный потолок обращений к модели. До 2026-08-04 у Pro/Business/
 * Enterprise он был null: ни одного ограничителя расходов на ИИ во всём
 * продукте, один пользователь мог сжечь любую сумму (аудит 2026-08-03).
 * Значения заданы владельцем: Free 20, Standard 100, Pro 500, Business 10000.
 * Enterprise — договорный тариф, здесь стоит страховочный потолок: он на
 * порядок выше Business и защищает от зацикленного интегратора, а не от клиента.
 */
export const PLAN_LIMITS: Record<string, { ai: number | null; docs: number | null; storageMb: number | null }> = {
  Free: { ai: 20, docs: 3, storageMb: 100 },
  Standard: { ai: 100, docs: 20, storageMb: 2 * 1024 },
  Pro: { ai: 500, docs: 80, storageMb: 50 * 1024 },
  Business: { ai: 10_000, docs: 700, storageMb: 1024 * 1024 },
  Enterprise: { ai: 50_000, docs: null, storageMb: null },
};

/** Мест в команде: null = без ограничения (Enterprise, как обещает тариф). */
export const PLAN_SEATS: Record<string, number | null> = {
  Free: 1,
  Standard: 1,
  Pro: 1,
  Business: 5,
  Enterprise: null,
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
export type PlanFeature =
  | 'docxExport'
  | 'templates'
  | 'compare'
  | 'signatures'
  | 'versions'
  | 'approvals'
  | 'team'
  | 'auditLog'
  | 'sso'
  | 'playbooks'
  | 'clm'
  | 'batch'
  | 'workflows'
  | 'apiAccess';

const FEATURE_MIN_PLAN: Record<PlanFeature, string[]> = {
  docxExport: ['Standard', 'Pro', 'Business', 'Enterprise'],
  templates: ['Standard', 'Pro', 'Business', 'Enterprise'],
  compare: ['Pro', 'Business', 'Enterprise'],
  signatures: ['Pro', 'Business', 'Enterprise'],
  versions: ['Pro', 'Business', 'Enterprise'],
  approvals: ['Pro', 'Business', 'Enterprise'],
  team: ['Business', 'Enterprise'],
  auditLog: ['Business', 'Enterprise'],
  sso: ['Business', 'Enterprise'],
  playbooks: ['Pro', 'Business', 'Enterprise'],
  clm: ['Pro', 'Business', 'Enterprise'],
  batch: ['Pro', 'Business', 'Enterprise'],
  workflows: ['Pro', 'Business', 'Enterprise'],
  apiAccess: ['Business', 'Enterprise'],
};

const FEATURE_LABEL: Record<PlanFeature, { ru: string; en: string; plans: string }> = {
  docxExport: { ru: 'Экспорт в DOCX', en: 'DOCX export', plans: 'Standard, Pro и Business' },
  templates: { ru: 'Генератор договоров', en: 'Contract generator', plans: 'Standard, Pro и Business' },
  compare: { ru: 'Сравнение версий (Redline)', en: 'Version compare (Redline)', plans: 'Pro и Business' },
  signatures: { ru: 'Электронная подпись', en: 'E-signatures', plans: 'Pro и Business' },
  versions: { ru: 'История версий', en: 'Version history', plans: 'Pro и Business' },
  approvals: { ru: 'Маршруты согласования', en: 'Approval workflows', plans: 'Pro и Business' },
  team: { ru: 'Команды и общие документы', en: 'Teams & shared documents', plans: 'Business' },
  auditLog: { ru: 'Журнал действий', en: 'Audit log', plans: 'Business' },
  sso: { ru: 'Единый вход (SSO)', en: 'Single Sign-On (SSO)', plans: 'Business' },
  playbooks: { ru: 'Плейбуки (стандартные позиции)', en: 'Playbooks (standard positions)', plans: 'Pro и Business' },
  clm: { ru: 'Сроки и обязательства договоров (CLM)', en: 'Contract lifecycle (CLM)', plans: 'Pro и Business' },
  batch: { ru: 'Массовый разбор пачки договоров', en: 'Batch contract review', plans: 'Pro и Business' },
  workflows: { ru: 'Агентные воркфлоу (сценарии)', en: 'Agentic workflows', plans: 'Pro и Business' },
  apiAccess: { ru: 'API-доступ для интеграций', en: 'API access', plans: 'Business' },
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
    'feature_locked',
    { feature, plan, plans: f.plans },
  );
}

/**
 * Как assertFeature, но активный участник команды наследует фичи ПЛАНА
 * ВЛАДЕЛЬЦА команды (Business-сиденья): владелец купил Business — вся команда
 * пользуется плейбуками/массовым разбором, а не упирается в личный Free.
 * Личный платный план участника тоже засчитывается (сначала дешёвая проверка
 * своего плана — без лишнего запроса про команду).
 */
export async function assertFeatureTeamAware(db: Db, userId: string, feature: PlanFeature): Promise<void> {
  try {
    await assertFeature(db, userId, feature);
    return;
  } catch (err) {
    const ownerId = await activeTeamOwnerFor(db, userId);
    if (!ownerId) throw err;
    await assertFeature(db, ownerId, feature); // 402 владельца, если и у команды нет
  }
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
      'ai_limit',
      { plan, limit, used: limit },
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

/** Месячный потолок вызовов публичного API (Business; Enterprise — безлимит). */
export function apiMonthlyLimitFor(plan: string): number | null {
  return plan === 'Enterprise' ? null : config.apiMonthlyLimit;
}

/** Текущее использование публичного API за месяц + потолок плана. */
export async function apiMonthlyUsage(db: Db, userId: string): Promise<{ plan: string; used: number; limit: number | null }> {
  const plan = await planFor(db, userId);
  const res = await db.query<{ api_requests: number | string }>(
    `SELECT api_requests FROM usage_counters
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [userId],
  );
  return { plan, used: Number(res.rows[0]?.api_requests ?? 0), limit: apiMonthlyLimitFor(plan) };
}

/**
 * Атомарно зарезервировать ОДИН вызов публичного API за месяц (зеркало
 * reserveDocument): инкремент-если-меньше-лимита одним UPDATE, без TOCTOU.
 * Превышение → 429 monthly_limit_exceeded (не 402: тариф уже включает API,
 * исчерпан именно месячный потолок вызовов). Принимает Queryable, чтобы резерв
 * и INSERT строки-задания шли в ОДНОЙ транзакции — тогда откат (INSERT упал)
 * отменяет и резерв, и юнит нельзя вернуть дважды.
 */
export async function reserveApiRequest(db: Queryable, userId: string): Promise<{ plan: string; reserved: boolean }> {
  const plan = (await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId])).rows[0]?.plan ?? 'Free';
  const limit = apiMonthlyLimitFor(plan);
  if (limit === null) {
    // Безлимит (Enterprise): гейта нет, но счётчик ведём — чтобы /usage и кабинет
    // показывали честное «used», а release при провале был симметричен платному
    // пути (иначе Enterprise всегда показывал бы 0 использований).
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
       VALUES ($1, date_trunc('month', now())::date, 0, 0, 1)
       ON CONFLICT (user_id, month) DO UPDATE SET api_requests = usage_counters.api_requests + 1`,
      [userId],
    );
    return { plan, reserved: true };
  }
  const res = await db.query<{ api_requests: number | string }>(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
     VALUES ($1, date_trunc('month', now())::date, 0, 0, 1)
     ON CONFLICT (user_id, month)
     DO UPDATE SET api_requests = usage_counters.api_requests + 1
       WHERE usage_counters.api_requests < $2
     RETURNING api_requests`,
    [userId, limit],
  );
  if (res.rows.length === 0) {
    throw new HttpError(
      429,
      `Monthly API limit reached (${limit}/${limit} analyses this month). The counter resets on the 1st.`,
      'monthly_limit_exceeded',
    );
  }
  return { plan, reserved: true };
}

/** Вернуть зарезервированный API-юнит при провале работы (не ниже нуля). */
export async function releaseApiRequest(db: Db, userId: string): Promise<void> {
  await db.query(
    `UPDATE usage_counters SET api_requests = GREATEST(api_requests - 1, 0)
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [userId],
  );
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
      'docs_limit',
      { plan, limit, used: docsCreated },
    );
  }
}

/** 402 when the incoming file would push stored bytes past the plan quota.
 *  Fast pre-check only (before doing expensive work); the authoritative,
 *  race-free enforcement is `withStorageReservation` at insert time. */
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
      'storage_limit',
      { plan, limit: limitMb, used: usedMb },
    );
  }
}

/**
 * Atomically enforce the storage quota AND run the upload INSERT under a
 * per-user lock, so N concurrent uploads can't each slip past a separate
 * check-then-insert gap (the old TOCTOU). `insert` runs inside the transaction
 * and only if the quota holds; when it's exceeded the insert never happens and
 * the caller cleans up any bytes it already wrote to storage.
 */
export async function withStorageReservation(
  db: Db,
  userId: string,
  incomingBytes: number,
  insert: (tx: Queryable) => Promise<void>,
  onReject?: () => Promise<void>,
): Promise<void> {
  try {
    await db.withTx(async (tx) => {
      // Serialize this user's storage ops so the sum below is authoritative for
      // concurrent uploads (each waits for the previous one's row to commit).
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const plan = (await tx.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId])).rows[0]?.plan ?? 'Free';
      const limitMb = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).storageMb;
      if (limitMb !== null) {
        const used = Number(
          (
            await tx.query<{ s: string | number | null }>(
              'SELECT coalesce(sum(size_bytes), 0) AS s FROM uploads WHERE user_id = $1',
              [userId],
            )
          ).rows[0]?.s ?? 0,
        );
        if (used + incomingBytes > limitMb * 1024 * 1024) {
          const usedMb = Math.round(used / (1024 * 1024));
          throw new HttpError(402, `Хранилище тарифа ${plan} заполнено (${usedMb} из ${limitMb} МБ). ${upgradeHint}`, 'storage_limit', {
            plan,
            limit: limitMb,
            used: usedMb,
          });
        }
      }
      await insert(tx);
    });
  } catch (err) {
    // The bytes were written to storage before this guarded insert — on quota
    // rejection (or any insert failure) clean them up so nothing is orphaned.
    if (onReject) await onReject().catch(() => undefined);
    throw err;
  }
}

/**
 * Atomically reserve ONE document against the monthly quota (mirrors
 * reserveAiRequest): the increment-if-under-limit is a single SQL statement, so
 * concurrent creates can't both pass a check-then-bump gap. Call inside the
 * document-creation transaction so a 402 rolls the new document back too.
 */
export async function reserveDocument(tx: Queryable, userId: string): Promise<void> {
  const plan = (await tx.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId])).rows[0]?.plan ?? 'Free';
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).docs;
  if (limit === null) {
    await bumpUsage(tx, userId, { docs: 1 }); // unlimited — just count
    return;
  }
  const res = await tx.query(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
     VALUES ($1, date_trunc('month', now())::date, 0, 1)
     ON CONFLICT (user_id, month)
     DO UPDATE SET docs_created = usage_counters.docs_created + 1
       WHERE usage_counters.docs_created < $2
     RETURNING docs_created`,
    [userId, limit],
  );
  if (res.rows.length === 0) {
    throw new HttpError(402, `Лимит документов тарифа ${plan} исчерпан (${limit}/${limit} в этом месяце). ${upgradeHint}`, 'docs_limit', {
      plan,
      limit,
      used: limit,
    });
  }
}
