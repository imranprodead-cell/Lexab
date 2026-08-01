/**
 * Subscription lifecycle — a small internal API deliberately shaped like a
 * payment-provider webhook, so wiring Stripe/Paddle later is just mapping their
 * events onto these functions (no schema/UI change):
 *   activatePlan       ≈ checkout.session.completed
 *   renewSubscription  ≈ invoice.paid
 *   markPastDue        ≈ invoice.payment_failed
 *   setCancelAtPeriodEnd / downgradeToFree — cancellation flow
 *
 * billing_events is append-only (DB trigger) and holds both lifecycle history
 * and legal evidence (consent waivers, ToS acceptances) — see migration 029.
 */
import type { Db, Queryable } from '../db.ts';
import { newId } from './ids.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { config } from '../config.ts';
import { getSubscription, lemonSqueezyEnabled, variantToPlan } from './lemonsqueezy.ts';

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
    | 'past_due'
    | 'canceled'
    | 'resumed'
    | 'refunded'
    | 'downgraded'
    | 'dunning';
  plan?: string | null;
  payload?: Record<string, unknown>;
}

/** Привязка строки подписки к Lemon Squeezy (заполняется из вебхуков/API). */
export interface LsLink {
  customerId: string | null;
  subscriptionId: string;
  variantId: string;
}

/** Опции провайдера: точный renews_at из payload вместо now()+interval. */
export interface ProviderOpts {
  renewsAt?: string | null;
  ls?: LsLink;
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
 * Activate (or re-activate) a paid plan and start a fresh billing period. The
 * month's usage counters reset here — post-PSP this runs from a verified
 * payment webhook, never from the client. Records a 'checkout' event.
 */
export async function activatePlan(
  db: Db,
  userId: string,
  email: string,
  plan: string,
  period: BillingPeriod,
  opts?: ProviderOpts,
): Promise<{ renewsAt: string | null }> {
  const interval = intervalFor(period);
  await db.withTx(async (tx) => {
    // Renewing the SAME plan keeps the month's usage counters — resetting them
    // would let a "Renew" click wipe the monthly quota (and the API cost ceiling)
    // mid-period. A plan change (or a first purchase) still gets a fresh quota.
    const prev = await tx.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId]);
    const samePlanRenew = prev.rows[0]?.plan === plan;
    // renews_at: точная дата провайдера (LS-вебхук) либо now()+interval (dev).
    // ls_*-привязка не затирается NULL-ами при dev-активациях (COALESCE).
    await tx.query(
      `INSERT INTO subscriptions (user_id, plan, status, period, renews_at, cancel_at_period_end, past_due_since, dunning_count,
                                  ls_customer_id, ls_subscription_id, ls_variant_id)
       VALUES ($1, $2, 'active', $3, COALESCE($5::timestamptz, now() + ($4)::interval), false, NULL, 0, $6, $7, $8)
       ON CONFLICT (user_id)
       DO UPDATE SET plan = $2, status = 'active', period = $3,
                     renews_at = COALESCE($5::timestamptz, now() + ($4)::interval),
                     cancel_at_period_end = false, past_due_since = NULL, dunning_count = 0,
                     ls_customer_id = COALESCE($6, subscriptions.ls_customer_id),
                     ls_subscription_id = COALESCE($7, subscriptions.ls_subscription_id),
                     ls_variant_id = COALESCE($8, subscriptions.ls_variant_id)`,
      [userId, plan, period, interval, opts?.renewsAt ?? null, opts?.ls?.customerId ?? null, opts?.ls?.subscriptionId ?? null, opts?.ls?.variantId ?? null],
    );
    // Fresh purchase or plan change = fresh quota for the current month.
    if (!samePlanRenew) {
      await tx.query(
        `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
         VALUES ($1, date_trunc('month', now())::date, 0, 0)
         ON CONFLICT (user_id, month) DO UPDATE SET ai_requests = 0, docs_created = 0`,
        [userId],
      );
    }
    await recordBillingEvent(tx, { userId, email, kind: 'checkout', plan, payload: { period } });
  });
  const res = await db.query<{ renews_at: Date | string }>('SELECT renews_at FROM subscriptions WHERE user_id = $1', [userId]);
  const r = res.rows[0]?.renews_at ?? null;
  return { renewsAt: r ? new Date(r).toISOString() : null };
}

/** Renewal succeeded (≈ invoice.paid): push the period forward, clear dunning. */
export async function renewSubscription(
  db: Db,
  userId: string,
  email: string,
  plan: string,
  period: BillingPeriod,
  opts?: ProviderOpts,
): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query(
      `UPDATE subscriptions SET status = 'active', renews_at = COALESCE($3::timestamptz, now() + ($2)::interval),
              past_due_since = NULL, dunning_count = 0 WHERE user_id = $1`,
      [userId, intervalFor(period), opts?.renewsAt ?? null],
    );
    await recordBillingEvent(tx, { userId, email, kind: 'renewal', plan });
  });
}

/** Renewal failed (≈ invoice.payment_failed): enter the past_due grace period.
 *  Самозащищённый переход (WHERE status='active'): гонка со свежим продлением
 *  (вебхук успел между SELECT sweep'а и этим вызовом) не роняет платящего в
 *  past_due; событие и письмо — только при фактическом переходе. */
export async function markPastDue(db: Db, userId: string, email: string, plan: string): Promise<boolean> {
  let changed = false;
  await db.withTx(async (tx) => {
    const res = await tx.query(
      `UPDATE subscriptions SET status = 'past_due', past_due_since = now(), dunning_count = 1
       WHERE user_id = $1 AND status = 'active' AND plan <> 'Free' RETURNING user_id`,
      [userId],
    );
    changed = res.rows.length > 0;
    if (changed) await recordBillingEvent(tx, { userId, email, kind: 'past_due', plan });
  });
  return changed;
}

/** Schedule (or cancel) an end-of-period cancellation. Access stays until then.
 *  Идемпотентно: событие в журнал — только при фактической смене флага (иначе
 *  гонка «наш роут против собственного вебхука LS» дублирует юридические
 *  записи в append-only журнале). */
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
  reason: 'canceled' | 'past_due',
  opts?: { clearProviderLink?: boolean },
): Promise<boolean> {
  let changed = false;
  await db.withTx(async (tx) => {
    const res = await tx.query(
      `UPDATE subscriptions SET plan = 'Free', status = 'active', renews_at = NULL,
              cancel_at_period_end = false, past_due_since = NULL, dunning_count = 0,
              ls_subscription_id = CASE WHEN $2 THEN NULL ELSE ls_subscription_id END,
              ls_variant_id = CASE WHEN $2 THEN NULL ELSE ls_variant_id END
       WHERE user_id = $1 AND plan <> 'Free' RETURNING user_id`,
      [userId, Boolean(opts?.clearProviderLink)],
    );
    changed = res.rows.length > 0;
    if (changed) await recordBillingEvent(tx, { userId, email, kind: 'downgraded', plan: 'Free', payload: { reason } });
  });
  return changed;
}

const GRACE_DAYS = Math.max(1, Number(process.env.BILLING_GRACE_DAYS ?? 7));

/**
 * Hourly lifecycle sweep (mirrors checkApprovalDeadlines). Idempotent via the
 * status/dunning_count guards — a re-run never double-charges or double-mails.
 *
 * Два класса строк:
 *  - БЕЗ ls_subscription_id (dev-fallback): прежнее поведение — истёкшие
 *    платные → past_due, после grace-окна → Free.
 *  - С ls_subscription_id (Lemon Squeezy): штатный путь — вебхуки; sweep лишь
 *    страховка от ПОТЕРЯННЫХ вебхуков, с щадящими буферами: past_due только
 *    через 48ч после renews_at (обычная задержка вебхука — секунды), Free —
 *    только через 21 день past_due (LS сам ведёт dunning ~2 недели и завершает
 *    его событием subscription_expired; наш 7-дневный grace обогнал бы их
 *    восстановление платежа).
 */
const LS_RENEW_BUFFER = '48 hours';
const LS_PAST_DUE_DAYS = 21;

/**
 * Правда провайдера о LS-подписке — sweep НИКОГДА не карает платящего вслепую
 * (вебхуки могли теряться неделями, пока LS исправно списывал деньги):
 *  - 'alive'    — LS считает подписку живой; локальное состояние продлено;
 *  - 'past_due' — LS подтверждает просрочку (его dunning ещё идёт);
 *  - 'dead'     — expired / отменена с прошедшим ends_at / 404;
 *  - 'unknown'  — API недоступен → fail-open: строку не трогаем.
 */
async function fetchLsTruth(db: Db, userId: string, email: string, localPlan: string, lsId: string): Promise<'alive' | 'past_due' | 'dead' | 'unknown'> {
  if (!lemonSqueezyEnabled()) return 'unknown';
  let sub;
  try {
    sub = await getSubscription(lsId);
  } catch (err) {
    if (err instanceof Error && /\(404\)/.test(err.message)) return 'dead';
    console.warn(`[billing] LS reconcile failed for ${lsId} — keeping paid access:`, err instanceof Error ? err.message : err);
    return 'unknown';
  }
  const st = String(sub.attributes.status);
  if (st === 'active' || st === 'on_trial') {
    const mapped = variantToPlan(sub.attributes.variant_id);
    await renewSubscription(db, userId, email, mapped?.plan ?? localPlan, mapped?.period ?? 'monthly', { renewsAt: sub.attributes.renews_at });
    // Подписка жива без ends_at → возможное «возобновление в портале LS»,
    // вебхук которого потерялся: снимаем зависший флаг отмены.
    if (!sub.attributes.ends_at) {
      await db.query('UPDATE subscriptions SET cancel_at_period_end = false WHERE user_id = $1 AND cancel_at_period_end = true', [userId]);
    }
    return 'alive';
  }
  if (st === 'cancelled' && sub.attributes.ends_at && new Date(sub.attributes.ends_at).getTime() > Date.now()) {
    await db.query('UPDATE subscriptions SET renews_at = $2, cancel_at_period_end = true WHERE user_id = $1', [userId, sub.attributes.ends_at]);
    return 'alive';
  }
  if (st === 'paused') return 'alive'; // пауза платежей — не наказываем доступ
  if (st === 'past_due' || st === 'unpaid') return 'past_due';
  return 'dead'; // expired / cancelled с прошедшим ends_at
}

export async function checkBillingLifecycle(db: Db): Promise<void> {
  // 1. Paid subs whose period ended → past_due + first dunning email.
  const expired = await db.query<{ user_id: string; plan: string; email: string; name: string; ls_subscription_id: string | null }>(
    `SELECT s.user_id, s.plan, u.email, u.name, s.ls_subscription_id
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.plan <> 'Free' AND s.status = 'active' AND s.cancel_at_period_end IS NOT TRUE
       AND s.renews_at IS NOT NULL
       AND ((s.ls_subscription_id IS NULL AND s.renews_at < now())
         OR (s.ls_subscription_id IS NOT NULL AND s.renews_at < now() - ($1)::interval))`,
    [LS_RENEW_BUFFER],
  );
  for (const row of expired.rows) {
    if (row.ls_subscription_id) {
      const truth = await fetchLsTruth(db, row.user_id, row.email, row.plan, row.ls_subscription_id);
      if (truth === 'alive' || truth === 'unknown') continue;
      if (truth === 'dead') {
        await downgradeToFree(db, row.user_id, row.email, 'past_due', { clearProviderLink: true });
        continue;
      }
      // truth === 'past_due': провайдер подтвердил — переходим штатно ниже.
    }
    const changed = await markPastDue(db, row.user_id, row.email, row.plan);
    if (!changed) continue; // гонка со свежим продлением — письмо не шлём
    void sendMail({
      to: row.email,
      subject: biSubject('Lexab: не удалось продлить подписку', 'Lexab: subscription renewal failed'),
      html: mailLayout(
        biLine('Продление не прошло', 'Renewal failed'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(row.name)}</strong>!</p>
         <p>Мы не смогли продлить ваш тариф <strong>${escapeMailHtml(row.plan)}</strong>. Доступ сохраняется ещё <strong>${GRACE_DAYS} дней</strong> — обновите способ оплаты, чтобы не потерять его.</p>`,
          `<p>Hello <strong>${escapeMailHtml(row.name)}</strong>,</p>
         <p>We could not renew your <strong>${escapeMailHtml(row.plan)}</strong> plan. Your access remains for another <strong>${GRACE_DAYS} days</strong> — update your payment method so you do not lose it.</p>`,
        ),
        biLine('Проверить подписку', 'Check subscription'),
        `${config.appBaseUrl}/settings`,
      ),
    });
  }

  // 2. past_due beyond the grace window → downgrade to Free + final email.
  const lapsed = await db.query<{ user_id: string; plan: string; email: string; name: string; ls_subscription_id: string | null }>(
    `SELECT s.user_id, s.plan, u.email, u.name, s.ls_subscription_id
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.status = 'past_due' AND s.past_due_since IS NOT NULL
       AND ((s.ls_subscription_id IS NULL AND s.past_due_since < now() - ($1 || ' days')::interval)
         OR (s.ls_subscription_id IS NOT NULL AND s.past_due_since < now() - ($2 || ' days')::interval))`,
    [String(GRACE_DAYS), String(LS_PAST_DUE_DAYS)],
  );
  for (const row of lapsed.rows) {
    if (row.ls_subscription_id) {
      // Даунгрейд LS-строки — только с подтверждением провайдера: платёж мог
      // восстановиться внутри его dunning'а, а вебхуки — теряться.
      const truth = await fetchLsTruth(db, row.user_id, row.email, row.plan, row.ls_subscription_id);
      if (truth !== 'dead') continue;
      const changed = await downgradeToFree(db, row.user_id, row.email, 'past_due', { clearProviderLink: true });
      if (!changed) continue;
    } else {
      const changed = await downgradeToFree(db, row.user_id, row.email, 'past_due');
      if (!changed) continue;
    }
    void sendMail({
      to: row.email,
      subject: biSubject('Lexab: тариф переведён на Free', 'Lexab: your plan was switched to Free'),
      html: mailLayout(
        biLine('Подписка завершена', 'Subscription ended'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(row.name)}</strong>!</p>
         <p>Оплата так и не поступила, поэтому аккаунт переведён на бесплатный тариф. Вы можете оформить подписку снова в любой момент.</p>`,
          `<p>Hello <strong>${escapeMailHtml(row.name)}</strong>,</p>
         <p>The payment never arrived, so your account has been moved to the Free plan. You can subscribe again at any time.</p>`,
        ),
        biLine('Выбрать тариф', 'Choose a plan'),
        `${config.appBaseUrl}/plans`,
      ),
    });
  }

  // 3. Cancel-at-period-end subs whose period has now ended → downgrade (no email:
  // the user chose this and already saw the effective date). LS-строки штатно
  // закрывает вебхук subscription_expired — sweep подстраховывает с буфером.
  const ended = await db.query<{ user_id: string; email: string; plan: string; ls_subscription_id: string | null }>(
    `SELECT s.user_id, u.email, s.plan, s.ls_subscription_id FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.cancel_at_period_end = true AND s.plan <> 'Free'
       AND s.renews_at IS NOT NULL
       AND ((s.ls_subscription_id IS NULL AND s.renews_at < now())
         OR (s.ls_subscription_id IS NOT NULL AND s.renews_at < now() - ($1)::interval))`,
    [LS_RENEW_BUFFER],
  );
  for (const row of ended.rows) {
    if (row.ls_subscription_id) {
      // Пользователь мог возобновить подписку в портале LS (вебхук потерялся) —
      // сверяемся; fetchLsTruth сам продлит и снимет флаг при 'alive'.
      const truth = await fetchLsTruth(db, row.user_id, row.email, row.plan, row.ls_subscription_id);
      if (truth !== 'dead') continue;
    }
    await downgradeToFree(db, row.user_id, row.email, 'canceled', { clearProviderLink: row.ls_subscription_id !== null });
  }
}
