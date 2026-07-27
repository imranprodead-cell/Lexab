/**
 * GET /billing/subscription | POST /billing/checkout
 * Checkout returns a hosted-checkout URL. Wire a real PSP (Stripe/Paddle) by
 * replacing `checkoutUrl` with the provider's session URL.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { toIso } from '../lib/format.ts';
import { notify } from '../lib/notify.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { monthlyUsage, PLAN_LIMITS, planFor, storageUsedBytes } from '../lib/limits.ts';
import { config } from '../config.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import {
  activatePlan,
  recordBillingEvent,
  setCancelAtPeriodEnd,
  TERMS_VERSION,
  type BillingPeriod,
} from '../lib/billing.ts';
import { audit } from '../lib/audit.ts';

// The exact waiver wording shown at checkout — snapshotted into the consent
// event as the strongest evidence that the user gave informed consent.
const WAIVER_WORDING = {
  ru: 'Я прошу начать оказание платной услуги немедленно и подтверждаю, что теряю право на 14-дневный отказ (возврат) после начала предоставления услуги.',
  en: 'I request that the paid service begin immediately and acknowledge that I lose the 14-day right of withdrawal (refund) once performance has started.',
};

// Only paid plans are purchasable. 'Free' is deliberately excluded: a checkout
// resets the month's usage counters, so accepting {plan:'Free'} let a Free user
// wipe their own quota (and the API cost ceiling) on demand — an abuse loophole.
// Downgrading to Free happens through the cancellation flow, never checkout.
const PURCHASABLE_PLANS = ['Standard', 'Pro', 'Business'];

export function billingRoutes(app: FastifyInstance, db: Db): void {
  app.get('/billing/subscription', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ plan: string; status: string; renews_at: Date | string | null; cancel_at_period_end: boolean }>(
      'SELECT plan, status, renews_at, cancel_at_period_end FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = res.rows[0] ?? { plan: 'Free', status: 'active', renews_at: null, cancel_at_period_end: false };
    return {
      plan: row.plan,
      status: row.status,
      renewsAt: row.renews_at ? toIso(row.renews_at) : null,
      periodEnd: row.renews_at ? toIso(row.renews_at) : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    };
  });

  // Current usage vs the plan's monthly limits (drives the Settings widget).
  // Reads the same counters the enforcement uses — deletion frees storage only.
  app.get('/billing/limits', { preHandler: [app.authenticate] }, async (req) => {
    const userId = req.currentUser.id;
    const [plan, usage, storageBytes] = await Promise.all([
      planFor(db, userId),
      monthlyUsage(db, userId),
      storageUsedBytes(db, userId),
    ]);
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free;

    return {
      plan,
      aiRequests: { used: usage.aiRequests, limit: limits.ai },
      documents: { used: usage.docsCreated, limit: limits.docs },
      storageMb: { used: Math.round((storageBytes / (1024 * 1024)) * 10) / 10, limit: limits.storageMb },
    };
  });

  // Enterprise "contact sales": the request lands in the founder's inbox.
  app.post(
    '/billing/contact-sales',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req) => {
      const body = req.body === undefined || req.body === null ? {} : asObject(req.body);
      const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : '';
      const u = req.currentUser;
      // Без CONTACT_EMAIL письмо пропускается — лид не должен пропасть молча:
      // громкий лог с данными для связи остаётся в журнале сервера.
      if (!config.contactEmail) {
        req.log.error({ lead: { name: u.name, firm: u.firm, email: u.email, note: note.slice(0, 200) } }, 'contact-sales: CONTACT_EMAIL is not set — Enterprise lead only in this log');
      }
      await sendMail({
        to: config.contactEmail,
        subject: `Enterprise-заявка: ${u.name} (${u.firm})`,
        html: mailLayout(
          'Новая Enterprise-заявка',
          `<p><strong>${escapeMailHtml(u.name)}</strong> из <strong>${escapeMailHtml(u.firm)}</strong> интересуется планом Enterprise.</p>
           <p>Email для связи: <a href="mailto:${escapeMailHtml(u.email)}">${escapeMailHtml(u.email)}</a><br/>
           Юрисдикция: ${escapeMailHtml(u.jurisdiction)}</p>
           ${note ? `<p>Комментарий: ${escapeMailHtml(note)}</p>` : ''}`,
        ),
      });
      // The founder also sees the lead in their bell (if that email has an account).
      const founder = await getUserByEmail(db, config.contactEmail.toLowerCase());
      if (founder) {
        await notify(db, founder.id, 'docs', 'Заявка Enterprise', 'Enterprise lead', {
          bodyRu: `${u.name} (${u.firm}) · ${u.email}`,
          bodyEn: `${u.name} (${u.firm}) · ${u.email}`,
        });
      }
      return { ok: true };
    },
  );

  // Purchase / renew a plan. PRE-PSP: activation is immediate — when Stripe/
  // Paddle arrives, its payment step slots in front of activatePlan (called
  // from the provider webhook instead of here). Requires the withdrawal-waiver
  // consent, recorded as legal evidence.
  app.post('/billing/checkout', { preHandler: [app.authenticateReal] }, async (req) => {
    const body = asObject(req.body);
    const plan = requireString(body, 'plan', { min: 1, max: 50 });
    const normalized = PURCHASABLE_PLANS.find((p) => p.toLowerCase() === plan.toLowerCase());
    if (!normalized) {
      // A 'Free' request is the loophole attempt — point to cancellation instead.
      if (plan.toLowerCase() === 'free') {
        throw new HttpError(400, 'Бесплатный план нельзя «купить». Понизить тариф можно через отмену подписки. / Free plan is not purchasable — downgrade via cancellation.');
      }
      throw new HttpError(400, `План должен быть одним из: ${PURCHASABLE_PLANS.join(', ')}`);
    }
    // Informed consent to immediate performance is REQUIRED — it's what makes
    // the no-refund term lawful (EU CRD art.16(m) / UK CCR reg.36-37).
    if (body.consent !== true) {
      throw new HttpError(400, 'Требуется согласие на немедленное начало услуги и отказ от 14-дневного возврата. / Consent to immediate performance (waiving the 14-day withdrawal right) is required.');
    }
    const period: BillingPeriod = body.period === 'yearly' ? 'yearly' : 'monthly';
    const discountPercent = period === 'yearly' ? 15 : 0;

    // Record the waiver BEFORE activation, snapshotting the exact wording + IP +
    // UA + terms version (durable evidence the withdrawal right was waived).
    await recordBillingEvent(db, {
      userId: req.currentUser.id,
      email: req.currentUser.email,
      kind: 'consent_waiver',
      plan: normalized,
      payload: { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300), termsVersion: TERMS_VERSION, wording: WAIVER_WORDING },
    });

    const { renewsAt } = await activatePlan(db, req.currentUser.id, req.currentUser.email, normalized, period);
    await audit(db, req, { type: 'billing.checkout', teamOwnerId: req.currentUser.id, metadata: { plan: normalized, period } });

    await notify(db, req.currentUser.id, 'check', 'Подписка активирована', 'Plan activated', {
      bodyRu: `${normalized} · ${period === 'yearly' ? 'годовая' : 'месячная'} · лимиты обновлены`,
      bodyEn: `${normalized} · ${period} · limits refreshed`,
      action: { kind: 'open', data: '/settings' },
    });
    // Durable-medium confirmation restating the waiver + no-refund rule.
    void sendMail({
      to: req.currentUser.email,
      subject: biSubject(`Lexab: подписка ${normalized} активирована`, `Lexab: your ${normalized} plan is active`),
      html: mailLayout(
        biLine('Подписка активирована', 'Plan activated'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(req.currentUser.name)}</strong>!</p>
         <p>Тариф <strong>${escapeMailHtml(normalized)}</strong> (${period === 'yearly' ? 'годовой' : 'месячный'}) активирован.</p>
         <p>Вы подтвердили немедленное начало услуги и отказались от 14-дневного права возврата. Оплата за начатый период не возвращается; при отмене доступ сохраняется до конца оплаченного срока. Ваши законные права потребителя это не затрагивает.</p>`,
          `<p>Hello <strong>${escapeMailHtml(req.currentUser.name)}</strong>,</p>
         <p>Your <strong>${escapeMailHtml(normalized)}</strong> plan (${period === 'yearly' ? 'yearly' : 'monthly'}) is now active.</p>
         <p>You confirmed that the service starts immediately and waived the 14-day right of withdrawal. Payment for a started period is non-refundable; if you cancel, access remains until the end of the paid term. Your statutory consumer rights are not affected.</p>`,
        ),
        biLine('Управление подпиской', 'Manage subscription'),
        `${config.appBaseUrl}/settings`,
      ),
    });

    return { ok: true, plan: normalized, period, discountPercent, renewsAt };
  });

  // Cancel at period end: keep access until renews_at, then the sweep downgrades.
  app.post('/billing/cancel', { preHandler: [app.authenticateReal] }, async (req) => {
    const sub = await db.query<{ plan: string; cancel_at_period_end: boolean; renews_at: Date | string | null }>(
      'SELECT plan, cancel_at_period_end, renews_at FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = sub.rows[0];
    if (!row || row.plan === 'Free') throw new HttpError(400, 'Активной платной подписки нет. / No active paid subscription.');
    if (row.cancel_at_period_end) throw new HttpError(400, 'Отмена уже запланирована. / Cancellation is already scheduled.');
    await setCancelAtPeriodEnd(db, req.currentUser.id, req.currentUser.email, true);
    return { ok: true, cancelAtPeriodEnd: true, periodEnd: row.renews_at ? toIso(row.renews_at) : null };
  });

  // Undo a scheduled cancellation while the period is still running.
  app.post('/billing/cancel/revert', { preHandler: [app.authenticateReal] }, async (req) => {
    const sub = await db.query<{ cancel_at_period_end: boolean; renews_at: Date | string | null }>(
      'SELECT cancel_at_period_end, renews_at FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = sub.rows[0];
    if (!row?.cancel_at_period_end) throw new HttpError(400, 'Отмена не запланирована. / No cancellation is scheduled.');
    if (row.renews_at && new Date(row.renews_at).getTime() < Date.now()) {
      throw new HttpError(400, 'Период уже завершился. / The period has already ended.');
    }
    await setCancelAtPeriodEnd(db, req.currentUser.id, req.currentUser.email, false);
    return { ok: true, cancelAtPeriodEnd: false };
  });
}
