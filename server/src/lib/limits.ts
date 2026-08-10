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
  Free: { ai: 20, docs: 3, storageMb: 50 },
  Standard: { ai: 100, docs: 20, storageMb: 250 },
  Pro: { ai: 500, docs: 80, storageMb: 500 },
  Business: { ai: 10_000, docs: 500, storageMb: 1024 },
  Enterprise: { ai: 50_000, docs: null, storageMb: null },
};

/**
 * ПЕРСОНАЛЬНЫЕ ЛИМИТЫ поверх тарифа (админ-панель, миграция 058).
 *
 * Конкретному аккаунту можно выдать больше или меньше, чем прописано в коде,
 * не трогая тариф: «Business, но 3000 документов» или «Pro с урезанным ИИ».
 * NULL в колонке = не переопределено (действует значение тарифа), -1 = без
 * ограничения. Читается для ВЛАДЕЛЬЦА КОТЛА: у команды лимиты общие, значит и
 * персональная надбавка принадлежит владельцу, а не каждому участнику.
 */
export interface EffectiveLimits {
  ai: number | null;
  docs: number | null;
  storageMb: number | null;
  seats: number | null;
  apiMonthly: number | null;
  /** Какие поля заданы вручную — для честной подписи в интерфейсе. */
  overridden: string[];
}

const sentinel = (v: number | null | undefined, fallback: number | null): number | null => {
  if (v === null || v === undefined) return fallback; // не переопределено
  return v < 0 ? null : v; // -1 = без ограничения
};

export async function effectiveLimits(db: Queryable, quotaUserId: string, plan: string): Promise<EffectiveLimits> {
  const base = PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free;
  const baseSeats = PLAN_SEATS[plan] ?? PLAN_SEATS.Free;
  const baseApi = plan === 'Enterprise' ? null : config.apiMonthlyLimit;
  const res = await db.query<{
    ai: number | null;
    docs: number | null;
    storage_mb: number | null;
    seats: number | null;
    api_monthly: number | null;
  }>('SELECT ai, docs, storage_mb, seats, api_monthly FROM user_limit_overrides WHERE user_id = $1', [quotaUserId]);
  const o = res.rows[0];
  const overridden: string[] = [];
  if (o) {
    if (o.ai !== null) overridden.push('ai');
    if (o.docs !== null) overridden.push('docs');
    if (o.storage_mb !== null) overridden.push('storageMb');
    if (o.seats !== null) overridden.push('seats');
    if (o.api_monthly !== null) overridden.push('apiMonthly');
  }
  return {
    ai: sentinel(o?.ai, base.ai),
    docs: sentinel(o?.docs, base.docs),
    storageMb: sentinel(o?.storage_mb, base.storageMb),
    seats: sentinel(o?.seats, baseSeats),
    apiMonthly: sentinel(o?.api_monthly, baseApi),
    overridden,
  };
}

/**
 * ЧТО ИЗ КАКОГО ЛИМИТА СПИСЫВАЕТСЯ (решение владельца 2026-08-06).
 *
 * Лимит ИИ-запросов — ТОЛЬКО переписка в чате: пользователь спросил, модель
 * ответила текстом. Больше ничего.
 *
 * Вся работа с договорами — из лимита ДОКУМЕНТОВ, и стоит по-разному, потому
 * что по-разному стоит нам: сравнение версий гонит через модель два полных
 * текста сразу, генерация договора пишет документ с нуля, обычный разбор
 * читает один текст.
 *
 * Числа заданы владельцем. Меняются здесь — и меняются везде: и в гейтах, и в
 * подсказке интерфейса, которая читает эту же таблицу через /billing/limits.
 */
export const DOC_COST = {
  /** Разбор одного договора (загрузка, массовый разбор, агентный сценарий). */
  analysis: 1,
  /** Создание договора: из промпта или по шаблону. */
  draft: 2,
  /** Сравнение версий — самая дорогая операция: два полных текста в одном запросе. */
  compare: 5,
} as const;

/** Мест в команде: null = без ограничения (Enterprise, как обещает тариф). */
export const PLAN_SEATS: Record<string, number | null> = {
  Free: 1,
  Standard: 1,
  Pro: 1,
  Business: 5,
  Enterprise: null,
};

export async function planFor(db: Queryable, userId: string): Promise<string> {
  const res = await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId]);
  return res.rows[0]?.plan ?? 'Free';
}

/**
 * ЧЕЙ СЧЁТЧИК РАСХОДУЕТСЯ — общий котёл команды.
 *
 * Место в команде — это то, за что владелец заплатил, поэтому 500 документов
 * Business общие на ВСЮ команду, а не по 500 на каждого: запрос любого
 * участника списывает лимит владельца и считается по ЕГО тарифу.
 *
 * Котёл включается ТОЛЬКО когда план владельца действительно даёт команды
 * (Business/Enterprise). Иначе владелец, слетевший на Free, утащил бы всех
 * своих участников в лимит 20 запросов — они бы разом лишились и своего
 * личного тарифа, и оплаченного командного.
 */
export async function quotaOwnerFor(db: Queryable, userId: string): Promise<{ ownerId: string; plan: string }> {
  const teamOwner = await activeTeamOwnerFor(db, userId);
  if (teamOwner) {
    const ownerPlan = await planFor(db, teamOwner);
    if (planHasFeature(ownerPlan, 'team')) return { ownerId: teamOwner, plan: ownerPlan };
  }
  return { ownerId: userId, plan: await planFor(db, userId) };
}

/**
 * Как quotaOwnerFor, но ещё и список пользователей, чьи файлы входят в общее
 * хранилище. Хранилище считается суммой по строкам uploads, поэтому один
 * ownerId тут недостаточен: файлы лежат под тем, кто их загрузил.
 */
export async function storagePoolFor(
  db: Queryable,
  userId: string,
): Promise<{ ownerId: string; plan: string; poolIds: string[] }> {
  const { ownerId, plan } = await quotaOwnerFor(db, userId);
  if (!planHasFeature(plan, 'team')) return { ownerId, plan, poolIds: [ownerId] };
  const res = await db.query<{ member_user_id: string | null }>(
    "SELECT member_user_id FROM team_members WHERE owner_user_id = $1 AND status = 'active' AND member_user_id IS NOT NULL",
    [ownerId],
  );
  const ids = new Set<string>([ownerId]);
  for (const r of res.rows) if (r.member_user_id) ids.add(r.member_user_id);
  return { ownerId, plan, poolIds: [...ids] };
}

export interface MonthlyUsage {
  aiRequests: number;
  docsCreated: number;
}

/** Current-month counters (0 when the row doesn't exist yet).
 *  Участник команды видит ОБЩИЙ расход команды — тот самый счётчик, который
 *  его запросы и списывают; показывать личный ноль было бы враньём. */
export async function monthlyUsage(db: Db, userId: string): Promise<MonthlyUsage> {
  const { ownerId } = await quotaOwnerFor(db, userId);
  const res = await db.query<{ ai_requests: number | string; docs_created: number | string }>(
    `SELECT ai_requests, docs_created FROM usage_counters
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [ownerId],
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

/** Total bytes currently stored (storage CAN be freed by deleting).
 *  На командном тарифе считается ВСЯ команда: хранилище тоже общее. */
export async function storageUsedBytes(db: Db, userId: string): Promise<number> {
  const { poolIds } = await storagePoolFor(db, userId);
  return storageUsedByPool(db, poolIds);
}

async function storageUsedByPool(db: Queryable, poolIds: string[]): Promise<number> {
  return Number(
    (
      await db.query<{ sum: string | number | null }>(
        'SELECT coalesce(sum(size_bytes), 0) AS sum FROM uploads WHERE user_id = ANY($1)',
        [poolIds],
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
export async function reserveAiRequest(
  db: Db,
  userId: string,
): Promise<{ plan: string; reserved: boolean; quotaUserId: string }> {
  const { ownerId: quotaUserId, plan } = await quotaOwnerFor(db, userId);
  const limit = (await effectiveLimits(db, quotaUserId, plan)).ai;
  if (limit === null) return { plan, reserved: false, quotaUserId };
  const res = await db.query<{ ai_requests: number | string }>(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
     VALUES ($1, date_trunc('month', now())::date, 1, 0)
     ON CONFLICT (user_id, month)
     DO UPDATE SET ai_requests = usage_counters.ai_requests + 1
       WHERE usage_counters.ai_requests < $2
     RETURNING ai_requests`,
    [quotaUserId, limit],
  );
  if (res.rows.length === 0) {
    throw new HttpError(
      402,
      `Лимит ИИ-запросов тарифа ${plan} исчерпан (${limit}/${limit} в этом месяце). ${upgradeHint}`,
      'ai_limit',
      { plan, limit, used: limit },
    );
  }
  return { plan, reserved: true, quotaUserId };
}

/** Give a reserved AI unit back when the work failed (never drops below zero).
 *  quotaUserId — ВСЕГДА тот, что вернул reserveAiRequest: между резервом и
 *  возвратом участника могли исключить из команды, и тогда единица вернулась бы
 *  не в тот счётчик (у команды — недостача, у бывшего участника — подарок). */
export async function releaseAiRequest(db: Db, userId: string, quotaUserId?: string): Promise<void> {
  const target = quotaUserId ?? (await quotaOwnerFor(db, userId)).ownerId;
  await db.query(
    `UPDATE usage_counters SET ai_requests = GREATEST(ai_requests - 1, 0)
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [target],
  );
}

/**
 * Run AI work with an atomic monthly reservation: reserve → work → on success
 * count unlimited plans post-hoc (limited plans were already counted by the
 * reservation); on failure, release the reservation so a failed/unavailable
 * model never consumes the user's allowance.
 */
export async function withAiRequest<T>(db: Db, userId: string, work: (plan: string) => Promise<T>): Promise<T> {
  const { plan, reserved, quotaUserId } = await reserveAiRequest(db, userId);
  try {
    const result = await work(plan);
    if (!reserved) await bumpUsage(db, quotaUserId, { ai: 1 });
    return result;
  } catch (err) {
    if (reserved) await releaseAiRequest(db, userId, quotaUserId);
    throw err;
  }
}

/** Месячный потолок вызовов публичного API (Business; Enterprise — безлимит). */
export function apiMonthlyLimitFor(plan: string): number | null {
  return plan === 'Enterprise' ? null : config.apiMonthlyLimit;
}

/** Текущее использование публичного API за месяц + потолок плана. */
export async function apiMonthlyUsage(db: Db, userId: string): Promise<{ plan: string; used: number; limit: number | null }> {
  const { ownerId, plan } = await quotaOwnerFor(db, userId);
  const limit = (await effectiveLimits(db, ownerId, plan)).apiMonthly;
  const res = await db.query<{ api_requests: number | string }>(
    `SELECT api_requests FROM usage_counters
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [ownerId],
  );
  return { plan, used: Number(res.rows[0]?.api_requests ?? 0), limit };
}

/**
 * Атомарно зарезервировать ОДИН вызов публичного API за месяц (зеркало
 * reserveDocument): инкремент-если-меньше-лимита одним UPDATE, без TOCTOU.
 * Превышение → 429 monthly_limit_exceeded (не 402: тариф уже включает API,
 * исчерпан именно месячный потолок вызовов). Принимает Queryable, чтобы резерв
 * и INSERT строки-задания шли в ОДНОЙ транзакции — тогда откат (INSERT упал)
 * отменяет и резерв, и юнит нельзя вернуть дважды.
 */
export async function reserveApiRequest(
  db: Queryable,
  userId: string,
): Promise<{ plan: string; reserved: boolean; quotaUserId: string }> {
  const { ownerId: quotaUserId, plan } = await quotaOwnerFor(db, userId);
  const limit = (await effectiveLimits(db, quotaUserId, plan)).apiMonthly;
  if (limit === null) {
    // Безлимит (Enterprise): гейта нет, но счётчик ведём — чтобы /usage и кабинет
    // показывали честное «used», а release при провале был симметричен платному
    // пути (иначе Enterprise всегда показывал бы 0 использований).
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
       VALUES ($1, date_trunc('month', now())::date, 0, 0, 1)
       ON CONFLICT (user_id, month) DO UPDATE SET api_requests = usage_counters.api_requests + 1`,
      [quotaUserId],
    );
    return { plan, reserved: true, quotaUserId };
  }
  const res = await db.query<{ api_requests: number | string }>(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
     VALUES ($1, date_trunc('month', now())::date, 0, 0, 1)
     ON CONFLICT (user_id, month)
     DO UPDATE SET api_requests = usage_counters.api_requests + 1
       WHERE usage_counters.api_requests < $2
     RETURNING api_requests`,
    [quotaUserId, limit],
  );
  if (res.rows.length === 0) {
    throw new HttpError(
      429,
      `Monthly API limit reached (${limit}/${limit} analyses this month). The counter resets on the 1st.`,
      'monthly_limit_exceeded',
    );
  }
  return { plan, reserved: true, quotaUserId };
}

/** Вернуть зарезервированный API-юнит при провале работы (не ниже нуля).
 *  quotaUserId — тот же, что вернул reserveApiRequest (см. releaseAiRequest). */
export async function releaseApiRequest(db: Db, userId: string, quotaUserId?: string): Promise<void> {
  const target = quotaUserId ?? (await quotaOwnerFor(db, userId)).ownerId;
  await db.query(
    `UPDATE usage_counters SET api_requests = GREATEST(api_requests - 1, 0)
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [target],
  );
}

/** 402 when creating one more document would exceed the monthly quota. */
export async function assertDocumentAllowance(db: Db, userId: string, units = 1): Promise<void> {
  const { ownerId, plan } = await quotaOwnerFor(db, userId);
  const limit = (await effectiveLimits(db, ownerId, plan)).docs;
  if (limit === null) return;
  const { docsCreated } = await monthlyUsage(db, userId);
  if (docsCreated + units > limit) {
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
  const { ownerId, plan, poolIds } = await storagePoolFor(db, userId);
  const limitMb = (await effectiveLimits(db, ownerId, plan)).storageMb;
  if (limitMb === null) return;
  const used = await storageUsedByPool(db, poolIds);
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
      // Блокируем строку ВЛАДЕЛЬЦА КОТЛА (на командном тарифе — владельца
      // команды): иначе двое участников грузили бы одновременно, каждый под
      // своей блокировкой, и оба прошли бы мимо общего лимита.
      const { plan, ownerId, poolIds } = await storagePoolFor(tx, userId);
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
      const limitMb = (await effectiveLimits(tx, ownerId, plan)).storageMb;
      if (limitMb !== null) {
        const used = Number(
          (
            await tx.query<{ s: string | number | null }>(
              'SELECT coalesce(sum(size_bytes), 0) AS s FROM uploads WHERE user_id = ANY($1)',
              [poolIds],
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
export async function reserveDocument(tx: Queryable, userId: string, units = 1): Promise<void> {
  const { ownerId: quotaUserId, plan } = await quotaOwnerFor(tx, userId);
  const limit = (await effectiveLimits(tx, quotaUserId, plan)).docs;
  if (limit === null) {
    await bumpUsage(tx, quotaUserId, { docs: units }); // unlimited — just count
    return;
  }
  const deny = (used: number) =>
    new HttpError(
      402,
      `Лимит документов тарифа ${plan} исчерпан (${used}/${limit} в этом месяце; операция стоит ${units}). ${upgradeHint}`,
      'docs_limit',
      { plan, limit, used, cost: units },
    );
  // Операция дороже всего месячного лимита — отказываем сразу: ветка INSERT ниже
  // создаёт строку без проверки потолка (проверять нечего, счётчика ещё нет),
  // и без этой строки дорогая операция прошла бы мимо лимита на пустом месяце.
  if (units > limit) throw deny(0);
  const res = await tx.query<{ docs_created: number | string }>(
    `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
     VALUES ($1, date_trunc('month', now())::date, 0, $3)
     ON CONFLICT (user_id, month)
     DO UPDATE SET docs_created = usage_counters.docs_created + $3
       WHERE usage_counters.docs_created + $3 <= $2
     RETURNING docs_created`,
    [quotaUserId, limit, units],
  );
  if (res.rows.length === 0) {
    const cur = await tx.query<{ docs_created: number | string }>(
      "SELECT docs_created FROM usage_counters WHERE user_id = $1 AND month = date_trunc('month', now())::date",
      [quotaUserId],
    );
    throw deny(Number(cur.rows[0]?.docs_created ?? limit));
  }
}

/** Вернуть зарезервированные единицы документов при провале работы. */
export async function releaseDocumentUnits(db: Db, userId: string, units: number, quotaUserId?: string): Promise<void> {
  const target = quotaUserId ?? (await quotaOwnerFor(db, userId)).ownerId;
  await db.query(
    `UPDATE usage_counters SET docs_created = GREATEST(docs_created - $2, 0)
     WHERE user_id = $1 AND month = date_trunc('month', now())::date`,
    [target, units],
  );
}

/**
 * Выполнить работу, списав N единиц лимита ДОКУМЕНТОВ: резерв до обращения к
 * модели, возврат при провале. Зеркало withAiRequest, но для операций с
 * договорами — сравнение версий, генерация договора.
 */
export async function withDocumentUnits<T>(
  db: Db,
  userId: string,
  units: number,
  work: (plan: string) => Promise<T>,
): Promise<T> {
  const { ownerId: quotaUserId, plan } = await quotaOwnerFor(db, userId);
  await reserveDocument(db, userId, units);
  try {
    return await work(plan);
  } catch (err) {
    await releaseDocumentUnits(db, userId, units, quotaUserId);
    throw err;
  }
}
