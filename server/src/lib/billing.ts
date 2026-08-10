/**
 * Жизненный цикл подписки БЕЗ платёжного провайдера (решение владельца
 * 2026-08-06: Lemon Squeezy отклонил верификацию магазина, интеграция удалена).
 *
 * Единственный способ получить платный тариф — выдача владельцем из
 * админ-панели: activatePlan вызывается ТОЛЬКО оттуда. Клиентских путей
 * повышения тарифа в продукте не существует.
 *
 * Раз оплаты нет, нет и «просрочки платежа»: у выданного тарифа есть срок, по
 * его наступлении аккаунт возвращается на Free. Прежняя ступень past_due с
 * догоняющими письмами убрана — повторять было бы нечего, а держать человека в
 * «просрочке» без выставленного счёта нечестно.
 *
 * billing_events append-only (триггер в базе) и хранит и историю, и правовые
 * доказательства (согласия, принятие условий) — см. миграцию 029.
 */
import type { Db, Queryable } from '../db.ts';
import { newId } from './ids.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { config } from '../config.ts';

/** Bump this when the Terms of Service change; every acceptance records it. */
export const TERMS_VERSION = '2026-07-14';

export type BillingPeriod = 'monthly' | 'yearly';

export interface BillingEventInput {
  userId: string | null;
  email: string;
  kind:
    | 'checkout'
    | 'consent_waiver'
    | 'terms_accepted'
    | 'renewal'
    | 'canceled'
    | 'resumed'
    | 'downgraded'
    | 'granted'
    | 'revoked'
    | 'limits_changed';
  plan?: string | null;
  payload?: Record<string, unknown>;
}

/** Опции выдачи: точная дата окончания вместо now()+период, кто выдал и зачем. */
export interface GrantOpts {
  /** ISO-дата окончания доступа. null = считать от периода. */
  renewsAt?: string | null;
  /** Почта администратора, выдавшего тариф. */
  grantedBy?: string | null;
  /** Комментарий администратора («оплатил переводом 06.08»). */
  note?: string | null;
}

/** Append one immutable billing/evidence event. */
export async function recordBillingEvent(db: Queryable, e: BillingEventInput): Promise<void> {
  await db.query(
    `INSERT INTO billing_events (id, user_id, email, kind, plan, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId('be'), e.userId, e.email, e.kind, e.plan ?? null, JSON.stringify(e.payload ?? {})],
  );
}

const intervalFor = (period: BillingPeriod) => (period === 'yearly' ? '1 year' : '1 month');

/**
 * Выдать (или переоткрыть) платный тариф. Вызывается ТОЛЬКО из админ-панели.
 * Счётчики месяца обнуляются при смене тарифа и первой выдаче; продление того
 * же тарифа их СОХРАНЯЕТ — иначе «продлить» стало бы кнопкой обнуления квоты
 * в середине месяца.
 */
export async function activatePlan(
  db: Db,
  userId: string,
  email: string,
  plan: string,
  period: BillingPeriod,
  opts?: GrantOpts,
): Promise<{ renewsAt: string | null }> {
  const interval = intervalFor(period);
  await db.withTx(async (tx) => {
    const prev = await tx.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId]);
    const samePlanRenew = prev.rows[0]?.plan === plan;
    await tx.query(
      `INSERT INTO subscriptions (user_id, plan, status, period, renews_at, cancel_at_period_end, past_due_since, dunning_count,
                                  source, granted_by, grant_note)
       VALUES ($1, $2, 'active', $3, COALESCE($5::timestamptz, now() + ($4)::interval), false, NULL, 0, 'manual', $6, $7)
       ON CONFLICT (user_id)
       DO UPDATE SET plan = $2, status = 'active', period = $3,
                     renews_at = COALESCE($5::timestamptz, now() + ($4)::interval),
                     cancel_at_period_end = false, past_due_since = NULL, dunning_count = 0,
                     source = 'manual', granted_by = $6, grant_note = $7`,
      [userId, plan, period, interval, opts?.renewsAt ?? null, opts?.grantedBy ?? null, opts?.note ?? null],
    );
    if (!samePlanRenew) {
      await tx.query(
        `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
         VALUES ($1, date_trunc('month', now())::date, 0, 0)
         ON CONFLICT (user_id, month) DO UPDATE SET ai_requests = 0, docs_created = 0`,
        [userId],
      );
    }
    await recordBillingEvent(tx, {
      userId,
      email,
      kind: 'granted',
      plan,
      payload: { period, grantedBy: opts?.grantedBy ?? null, note: opts?.note ?? null },
    });
  });
  const res = await db.query<{ renews_at: Date | string }>('SELECT renews_at FROM subscriptions WHERE user_id = $1', [userId]);
  const r = res.rows[0]?.renews_at ?? null;
  return { renewsAt: r ? new Date(r).toISOString() : null };
}

export async function setCancelAtPeriodEnd(db: Db, userId: string, email: string, flag: boolean): Promise<boolean> {
  let changed = false;
  await db.withTx(async (tx) => {
    const res = await tx.query(
      'UPDATE subscriptions SET cancel_at_period_end = $2 WHERE user_id = $1 AND cancel_at_period_end IS DISTINCT FROM $2 RETURNING user_id',
      [userId, flag],
    );
    changed = res.rows.length > 0;
    if (flag && changed) await recordBillingEvent(tx, { userId, email, kind: 'canceled', payload: { atPeriodEnd: true } });
  });
  return changed;
}

/** Move to the Free plan (period ended after cancellation, or grace expired).
 *  clearProviderLink=true (LS subscription_expired): подписка провайдера умерла
 *  насовсем — отвязываем её id (customer_id остаётся для истории/поддержки),
 *  чтобы новый checkout создал новую, а не пытался менять мёртвую. */
export async function downgradeToFree(
  db: Db,
  userId: string,
  email: string,
  reason: 'canceled' | 'expired' | 'revoked',
): Promise<boolean> {
  let changed = false;
  await db.withTx(async (tx) => {
    const res = await tx.query(
      `UPDATE subscriptions SET plan = 'Free', status = 'active', renews_at = NULL,
              cancel_at_period_end = false, past_due_since = NULL, dunning_count = 0,
              granted_by = NULL, grant_note = NULL
       WHERE user_id = $1 AND plan <> 'Free' RETURNING user_id`,
      [userId],
    );
    changed = res.rows.length > 0;
    if (changed) await recordBillingEvent(tx, { userId, email, kind: 'downgraded', plan: 'Free', payload: { reason } });
  });
  return changed;
}

/**
 * Часовой обход жизненного цикла. Идемпотентен: повторный запуск не понижает
 * дважды и не шлёт письмо повторно (после первого прохода plan уже 'Free', и
 * UPDATE ... WHERE plan <> 'Free' не находит строку).
 *
 * Провайдера нет — обход делает ровно две вещи:
 *  1. истёк срок выданного тарифа → Free + письмо «доступ закончился»;
 *  2. запланированная отмена, период закончился → Free (без письма: человек
 *     сам её запланировал и видел дату).
 */
export async function checkBillingLifecycle(db: Db): Promise<void> {
  const expired = await db.query<{ user_id: string; plan: string; email: string; name: string }>(
    `SELECT s.user_id, s.plan, u.email, u.name
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.plan <> 'Free' AND s.cancel_at_period_end IS NOT TRUE
       AND s.renews_at IS NOT NULL AND s.renews_at < now()`,
  );
  for (const row of expired.rows) {
    const changed = await downgradeToFree(db, row.user_id, row.email, 'expired');
    if (!changed) continue; // гонка с продлением из админ-панели — письма не шлём
    void sendMail({
      to: row.email,
      subject: biSubject('Lexab: срок тарифа истёк', 'Lexab: your plan has expired'),
      html: mailLayout(
        biLine('Срок тарифа истёк', 'Your plan has expired'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(row.name)}</strong>!</p>
         <p>Срок доступа к тарифу <strong>${escapeMailHtml(row.plan)}</strong> закончился, аккаунт переведён на бесплатный тариф. Ваши документы и история сохранены.</p>
         <p>Чтобы продлить — напишите нам, и мы откроем доступ снова.</p>`,
          `<p>Hello <strong>${escapeMailHtml(row.name)}</strong>,</p>
         <p>Your <strong>${escapeMailHtml(row.plan)}</strong> plan has expired and the account is back on the Free plan. Your documents and history are kept.</p>
         <p>To extend it, just message us and we will re-enable access.</p>`,
        ),
        biLine('Открыть Lexab', 'Open Lexab'),
        `${config.appBaseUrl}/settings`,
      ),
    });
  }

  const ended = await db.query<{ user_id: string; email: string }>(
    `SELECT s.user_id, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.cancel_at_period_end = true AND s.plan <> 'Free'
       AND s.renews_at IS NOT NULL AND s.renews_at < now()`,
  );
  for (const row of ended.rows) {
    await downgradeToFree(db, row.user_id, row.email, 'canceled');
  }
}
