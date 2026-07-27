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

/** Bump this when the Terms of Service change; every acceptance records it. */
export const TERMS_VERSION = '2026-07-14';

export type BillingPeriod = 'monthly' | 'yearly';

export interface BillingEventInput {
  userId: string | null;
  email: string;
  kind: 'checkout' | 'consent_waiver' | 'terms_accepted' | 'renewal' | 'past_due' | 'canceled' | 'downgraded' | 'dunning';
  plan?: string | null;
  payload?: Record<string, unknown>;
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
): Promise<{ renewsAt: string | null }> {
  const interval = intervalFor(period);
  await db.withTx(async (tx) => {
    // Renewing the SAME plan keeps the month's usage counters — resetting them
    // would let a "Renew" click wipe the monthly quota (and the API cost ceiling)
    // mid-period. A plan change (or a first purchase) still gets a fresh quota.
    const prev = await tx.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId]);
    const samePlanRenew = prev.rows[0]?.plan === plan;
    await tx.query(
      `INSERT INTO subscriptions (user_id, plan, status, period, renews_at, cancel_at_period_end, past_due_since, dunning_count)
       VALUES ($1, $2, 'active', $3, now() + ($4)::interval, false, NULL, 0)
       ON CONFLICT (user_id)
       DO UPDATE SET plan = $2, status = 'active', period = $3, renews_at = now() + ($4)::interval,
                     cancel_at_period_end = false, past_due_since = NULL, dunning_count = 0`,
      [userId, plan, period, interval],
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
export async function renewSubscription(db: Db, userId: string, email: string, plan: string, period: BillingPeriod): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query(
      `UPDATE subscriptions SET status = 'active', renews_at = now() + ($2)::interval,
              past_due_since = NULL, dunning_count = 0 WHERE user_id = $1`,
      [userId, intervalFor(period)],
    );
    await recordBillingEvent(tx, { userId, email, kind: 'renewal', plan });
  });
}

/** Renewal failed (≈ invoice.payment_failed): enter the past_due grace period. */
export async function markPastDue(db: Db, userId: string, email: string, plan: string): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query(
      `UPDATE subscriptions SET status = 'past_due', past_due_since = now(), dunning_count = 1 WHERE user_id = $1`,
      [userId],
    );
    await recordBillingEvent(tx, { userId, email, kind: 'past_due', plan });
  });
}

/** Schedule (or cancel) an end-of-period cancellation. Access stays until then. */
export async function setCancelAtPeriodEnd(db: Db, userId: string, email: string, flag: boolean): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query('UPDATE subscriptions SET cancel_at_period_end = $2 WHERE user_id = $1', [userId, flag]);
    if (flag) await recordBillingEvent(tx, { userId, email, kind: 'canceled', payload: { atPeriodEnd: true } });
  });
}

/** Move to the Free plan (period ended after cancellation, or grace expired). */
export async function downgradeToFree(db: Db, userId: string, email: string, reason: 'canceled' | 'past_due'): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query(
      `UPDATE subscriptions SET plan = 'Free', status = 'active', renews_at = NULL,
              cancel_at_period_end = false, past_due_since = NULL, dunning_count = 0 WHERE user_id = $1`,
      [userId],
    );
    await recordBillingEvent(tx, { userId, email, kind: 'downgraded', plan: 'Free', payload: { reason } });
  });
}

const GRACE_DAYS = Math.max(1, Number(process.env.BILLING_GRACE_DAYS ?? 7));

/**
 * Hourly lifecycle sweep (mirrors checkApprovalDeadlines). Idempotent via the
 * status/dunning_count guards — a re-run never double-charges or double-mails.
 * PRE-PSP: since "purchases" are free activations, expired paid subs move to
 * past_due (email 1), then to Free after the grace window (email 2). When the
 * PSP arrives, renewSubscription is called from its webhook and these rows
 * never reach the sweep.
 */
export async function checkBillingLifecycle(db: Db): Promise<void> {
  // 1. Paid subs whose period ended → past_due + first dunning email.
  const expired = await db.query<{ user_id: string; plan: string; email: string; name: string }>(
    `SELECT s.user_id, s.plan, u.email, u.name
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.plan <> 'Free' AND s.status = 'active' AND s.cancel_at_period_end IS NOT TRUE
       AND s.renews_at IS NOT NULL AND s.renews_at < now()`,
  );
  for (const row of expired.rows) {
    await markPastDue(db, row.user_id, row.email, row.plan);
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
  const lapsed = await db.query<{ user_id: string; plan: string; email: string; name: string }>(
    `SELECT s.user_id, s.plan, u.email, u.name
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.status = 'past_due' AND s.past_due_since IS NOT NULL
       AND s.past_due_since < now() - ($1 || ' days')::interval`,
    [String(GRACE_DAYS)],
  );
  for (const row of lapsed.rows) {
    await downgradeToFree(db, row.user_id, row.email, 'past_due');
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
  // the user chose this and already saw the effective date).
  const ended = await db.query<{ user_id: string; email: string }>(
    `SELECT s.user_id, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.cancel_at_period_end = true AND s.plan <> 'Free'
       AND s.renews_at IS NOT NULL AND s.renews_at < now()`,
  );
  for (const row of ended.rows) {
    await downgradeToFree(db, row.user_id, row.email, 'canceled');
  }
}
