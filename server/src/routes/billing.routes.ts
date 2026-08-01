/**
 * Биллинг: подписка/лимиты/чекаут/отмена + Lemon Squeezy.
 * С настроенным LS (config.lemonSqueezy.enabled) checkout возвращает
 * hosted-checkout URL, активация приходит ВЕБХУКОМ; без LS — 503, кроме
 * явного BILLING_FALLBACK=dev (прежняя мгновенная активация для локалки).
 */
import crypto from 'node:crypto';
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
  downgradeToFree,
  markPastDue,
  recordBillingEvent,
  renewSubscription,
  setCancelAtPeriodEnd,
  TERMS_VERSION,
  type BillingPeriod,
} from '../lib/billing.ts';
import {
  cancelSubscription,
  changeSubscriptionVariant,
  createCheckout,
  getSubscription,
  lemonSqueezyEnabled,
  resumeSubscription,
  variantFor,
  variantToPlan,
  verifyWebhookSignature,
  type LsSubscriptionAttributes,
} from '../lib/lemonsqueezy.ts';
import { newId } from '../lib/ids.ts';
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
    const res = await db.query<{
      plan: string;
      period: string | null;
      status: string;
      renews_at: Date | string | null;
      cancel_at_period_end: boolean;
      ls_subscription_id: string | null;
    }>(
      'SELECT plan, period, status, renews_at, cancel_at_period_end, ls_subscription_id FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = res.rows[0] ?? { plan: 'Free', period: null, status: 'active', renews_at: null, cancel_at_period_end: false, ls_subscription_id: null };
    return {
      plan: row.plan,
      period: row.period,
      status: row.status,
      renewsAt: row.renews_at ? toIso(row.renews_at) : null,
      periodEnd: row.renews_at ? toIso(row.renews_at) : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      // Фронт показывает кнопку «Управление оплатой» (портал LS) только когда
      // подписка реально живёт у провайдера.
      provider: row.ls_subscription_id ? ('lemonsqueezy' as const) : null,
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

  // Purchase / change a plan. Requires the withdrawal-waiver consent, recorded
  // as legal evidence BEFORE any provider call. Three paths:
  //   1) BILLING_FALLBACK=dev  — прежняя мгновенная активация (локалка/тесты);
  //   2) активная LS-подписка  — смена тарифа PATCH'ем (прорация у LS);
  //   3) новая покупка         — hosted-checkout URL, активация придёт вебхуком.
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

    // Record the waiver BEFORE activation/redirect, snapshotting the exact
    // wording + IP + UA + terms version (durable evidence of informed consent).
    await recordBillingEvent(db, {
      userId: req.currentUser.id,
      email: req.currentUser.email,
      kind: 'consent_waiver',
      plan: normalized,
      payload: { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300), termsVersion: TERMS_VERSION, wording: WAIVER_WORDING },
    });

    if (!lemonSqueezyEnabled()) {
      if (config.billingFallback !== 'dev') {
        // Без платёжного провайдера прод НЕ раздаёт планы бесплатно.
        throw new HttpError(503, 'Оплата временно недоступна — платёжный провайдер не настроен. / Payments are not configured yet.');
      }
      // Dev-фолбэк: мгновенная активация (ровно прежнее pre-PSP поведение).
      const { renewsAt } = await activatePlan(db, req.currentUser.id, req.currentUser.email, normalized, period);
      await audit(db, req, { type: 'billing.checkout', teamOwnerId: req.currentUser.id, metadata: { plan: normalized, period, mode: 'dev' } });
      await notify(db, req.currentUser.id, 'check', 'Подписка активирована', 'Plan activated', {
        bodyRu: `${normalized} · ${period === 'yearly' ? 'годовая' : 'месячная'} · лимиты обновлены`,
        bodyEn: `${normalized} · ${period} · limits refreshed`,
        action: { kind: 'open', data: '/settings' },
      });
      void sendActivationEmail(req.currentUser.email, req.currentUser.name, normalized, period);
      return { ok: true, plan: normalized, period, discountPercent, renewsAt };
    }

    const sub = await db.query<{
      plan: string;
      period: string | null;
      status: string;
      cancel_at_period_end: boolean;
      ls_subscription_id: string | null;
    }>(
      'SELECT plan, period, status, cancel_at_period_end, ls_subscription_id FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = sub.rows[0];
    const targetVariant = variantFor(normalized, period);
    if (!targetVariant) throw new HttpError(503, 'Платёжный провайдер настроен не полностью. / Payment provider is misconfigured.');

    // Активная подписка у провайдера → смена тарифа PATCH'ем (LS сам считает
    // прорату), никакого второго чекаута.
    if (row?.ls_subscription_id && row.plan !== 'Free' && (row.status === 'active' || row.status === 'past_due')) {
      if (row.cancel_at_period_end) {
        throw new HttpError(400, 'Отмена уже запланирована — сначала возобновите подписку. / Cancellation is scheduled — resume the subscription first.');
      }
      if (row.plan === normalized && (row.period ?? 'monthly') === period) {
        throw new HttpError(400, 'Этот тариф уже активен. / This plan is already active.');
      }
      let ls;
      try {
        ls = await changeSubscriptionVariant(row.ls_subscription_id, targetVariant);
      } catch (err) {
        req.log.error({ err }, 'lemonsqueezy: change variant failed');
        // Типовой случай — PayPal-подписка: LS не даёт менять её через API.
        throw new HttpError(400, 'Провайдер не смог сменить тариф. Попробуйте позже или воспользуйтесь порталом покупателя («Управление оплатой» в Настройках). / The payment provider could not change the plan — try again later or use the customer portal.');
      }
      const mapped = variantToPlan(ls.attributes.variant_id) ?? { plan: normalized, period };
      const { renewsAt } = await activatePlan(db, req.currentUser.id, req.currentUser.email, mapped.plan, mapped.period, {
        renewsAt: ls.attributes.renews_at,
        ls: { customerId: String(ls.attributes.customer_id), subscriptionId: ls.id, variantId: String(ls.attributes.variant_id) },
      });
      await stampLsGuard(db, req.currentUser.id, ls.attributes.updated_at);
      await audit(db, req, { type: 'billing.checkout', teamOwnerId: req.currentUser.id, metadata: { plan: mapped.plan, period: mapped.period, mode: 'ls_change' } });
      await notify(db, req.currentUser.id, 'check', 'Тариф изменён', 'Plan changed', {
        bodyRu: `${mapped.plan} · ${mapped.period === 'yearly' ? 'годовая' : 'месячная'} · разница досчитана проратой`,
        bodyEn: `${mapped.plan} · ${mapped.period} · prorated by the provider`,
        action: { kind: 'open', data: '/settings' },
      });
      return { ok: true, changed: true, plan: mapped.plan, period: mapped.period, discountPercent, renewsAt };
    }

    // Строка уже привязана к LS-подписке (например, sweep увёл на Free при
    // потерянных вебхуках, а подписка у провайдера ЖИВА и списывается):
    // прежде чем создавать ВТОРУЮ подписку — сверяемся с правдой провайдера.
    if (row?.ls_subscription_id) {
      let truth;
      try {
        truth = await getSubscription(row.ls_subscription_id);
      } catch (err) {
        if (err instanceof Error && /\(404\)/.test(err.message)) {
          // Подписки в LS нет — чистим мёртвую привязку и идём в checkout.
          await db.query('UPDATE subscriptions SET ls_subscription_id = NULL, ls_variant_id = NULL WHERE user_id = $1', [req.currentUser.id]);
        } else {
          req.log.error({ err }, 'lemonsqueezy: pre-checkout reconcile failed');
          // Правда неизвестна — вторую подписку вслепую не создаём.
          throw new HttpError(502, 'Не удалось проверить состояние подписки — попробуйте ещё раз. / Could not verify the subscription state — please retry.');
        }
      }
      if (truth) {
        const st = String(truth.attributes.status);
        const alive =
          st === 'active' || st === 'on_trial' || st === 'past_due' || st === 'unpaid' || st === 'paused' ||
          (st === 'cancelled' && truth.attributes.ends_at !== null && new Date(truth.attributes.ends_at).getTime() > Date.now());
        if (alive) {
          // Лечим локальное состояние по API-правде вместо второй подписки.
          const outcome = await convergeSubscription(
            db,
            { id: req.currentUser.id, email: req.currentUser.email, name: req.currentUser.name },
            truth.id,
            truth.attributes,
          );
          const healed = await db.query<{ plan: string; period: string | null; renews_at: Date | string | null }>(
            'SELECT plan, period, renews_at FROM subscriptions WHERE user_id = $1',
            [req.currentUser.id],
          );
          const h = healed.rows[0];
          await audit(db, req, { type: 'billing.checkout', teamOwnerId: req.currentUser.id, metadata: { plan: h?.plan, mode: 'ls_heal', note: outcome.note ?? null } });
          return {
            ok: true,
            changed: true,
            plan: h?.plan ?? normalized,
            period: (h?.period as BillingPeriod | null) ?? period,
            discountPercent,
            renewsAt: h?.renews_at ? toIso(h.renews_at) : null,
          };
        }
        // Подписка мертва — отвязываем и продолжаем к новой покупке.
        await db.query('UPDATE subscriptions SET ls_subscription_id = NULL, ls_variant_id = NULL WHERE user_id = $1', [req.currentUser.id]);
      }
    }

    // Новая покупка → hosted checkout; активация придёт вебхуком.
    let url: string;
    try {
      url = await createCheckout({
        variantId: targetVariant,
        userId: req.currentUser.id,
        email: req.currentUser.email,
        name: req.currentUser.name,
        redirectUrl: `${config.appBaseUrl}/plans?checkout=success`,
      });
    } catch (err) {
      req.log.error({ err }, 'lemonsqueezy: create checkout failed');
      throw new HttpError(502, 'Не удалось открыть страницу оплаты — попробуйте ещё раз. / Could not open the payment page — please retry.');
    }
    await audit(db, req, { type: 'billing.checkout', teamOwnerId: req.currentUser.id, metadata: { plan: normalized, period, mode: 'ls_checkout' } });
    return { ok: true, url, plan: normalized, period, discountPercent };
  });

  // Cancel at period end: keep access until renews_at. Для LS-подписок сначала
  // отменяем у провайдера (иначе он продолжит списывать!), локальная запись —
  // только после его успеха; ends_at провайдера становится точным концом доступа.
  app.post('/billing/cancel', { preHandler: [app.authenticateReal] }, async (req) => {
    const sub = await db.query<{ plan: string; cancel_at_period_end: boolean; renews_at: Date | string | null; ls_subscription_id: string | null }>(
      'SELECT plan, cancel_at_period_end, renews_at, ls_subscription_id FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = sub.rows[0];
    if (!row || row.plan === 'Free') throw new HttpError(400, 'Активной платной подписки нет. / No active paid subscription.');
    if (row.cancel_at_period_end) throw new HttpError(400, 'Отмена уже запланирована. / Cancellation is already scheduled.');
    let periodEnd = row.renews_at ? toIso(row.renews_at) : null;
    if (row.ls_subscription_id) {
      if (!lemonSqueezyEnabled()) throw new HttpError(503, 'Платёжный провайдер не настроен. / Payment provider is not configured.');
      let ls;
      try {
        ls = await cancelSubscription(row.ls_subscription_id);
      } catch (err) {
        req.log.error({ err }, 'lemonsqueezy: cancel failed');
        throw new HttpError(400, 'Провайдер не смог отменить подписку — попробуйте позже или через портал покупателя. / The provider could not cancel — try again or use the customer portal.');
      }
      if (ls.attributes.ends_at) {
        await db.query('UPDATE subscriptions SET renews_at = $2 WHERE user_id = $1', [req.currentUser.id, ls.attributes.ends_at]);
        periodEnd = toIso(ls.attributes.ends_at);
      }
      await stampLsGuard(db, req.currentUser.id, ls.attributes.updated_at);
    }
    await setCancelAtPeriodEnd(db, req.currentUser.id, req.currentUser.email, true);
    return { ok: true, cancelAtPeriodEnd: true, periodEnd };
  });

  // Undo a scheduled cancellation while the period is still running.
  app.post('/billing/cancel/revert', { preHandler: [app.authenticateReal] }, async (req) => {
    const sub = await db.query<{ cancel_at_period_end: boolean; renews_at: Date | string | null; ls_subscription_id: string | null }>(
      'SELECT cancel_at_period_end, renews_at, ls_subscription_id FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = sub.rows[0];
    if (!row?.cancel_at_period_end) throw new HttpError(400, 'Отмена не запланирована. / No cancellation is scheduled.');
    if (row.renews_at && new Date(row.renews_at).getTime() < Date.now()) {
      throw new HttpError(400, 'Период уже завершился. / The period has already ended.');
    }
    if (row.ls_subscription_id) {
      if (!lemonSqueezyEnabled()) throw new HttpError(503, 'Платёжный провайдер не настроен. / Payment provider is not configured.');
      let ls;
      try {
        ls = await resumeSubscription(row.ls_subscription_id);
      } catch (err) {
        req.log.error({ err }, 'lemonsqueezy: resume failed');
        throw new HttpError(400, 'Провайдер не смог возобновить подписку — попробуйте позже или через портал покупателя. / The provider could not resume — try again or use the customer portal.');
      }
      if (ls.attributes.renews_at) {
        await db.query('UPDATE subscriptions SET renews_at = $2 WHERE user_id = $1', [req.currentUser.id, ls.attributes.renews_at]);
      }
      await stampLsGuard(db, req.currentUser.id, ls.attributes.updated_at);
      await recordBillingEvent(db, { userId: req.currentUser.id, email: req.currentUser.email, kind: 'resumed' });
    }
    await setCancelAtPeriodEnd(db, req.currentUser.id, req.currentUser.email, false);
    return { ok: true, cancelAtPeriodEnd: false };
  });

  // Портал покупателя LS (смена карты, чеки, инвойсы). URL подписанный и
  // короткоживущий — запрашивается на клик, не кэшируется.
  app.get('/billing/portal', { preHandler: [app.authenticateReal] }, async (req) => {
    const sub = await db.query<{ ls_subscription_id: string | null }>(
      'SELECT ls_subscription_id FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const lsId = sub.rows[0]?.ls_subscription_id;
    if (!lsId || !lemonSqueezyEnabled()) {
      throw new HttpError(400, 'Портал оплаты доступен только для активной подписки. / The billing portal is available for provider-managed subscriptions only.');
    }
    const ls = await getSubscription(lsId).catch((err) => {
      req.log.error({ err }, 'lemonsqueezy: get subscription failed');
      throw new HttpError(502, 'Портал временно недоступен. / The portal is temporarily unavailable.');
    });
    const url = ls.attributes.urls?.customer_portal;
    if (!url) throw new HttpError(502, 'Портал временно недоступен. / The portal is temporarily unavailable.');
    return { url };
  });

  registerLemonSqueezyWebhook(app, db);
}

/** Продвинуть монотонный guard после НАШЕГО API-вызова к LS: иначе задержанный
 *  вебхук со старым состоянием (updated_at новее последнего ВЕБХУЧНОГО штампа,
 *  но старше API-применённого) откатил бы свежую смену тарифа/отмену. */
async function stampLsGuard(db: Db, userId: string, updatedAt: string | undefined): Promise<void> {
  if (!updatedAt) return;
  await db.query(
    `UPDATE subscriptions
     SET ls_event_updated_at = GREATEST(COALESCE(ls_event_updated_at, '-infinity'::timestamptz), $2::timestamptz)
     WHERE user_id = $1`,
    [userId, updatedAt],
  );
}

/** Durable-medium подтверждение активации (повторяет waiver + no-refund). */
async function sendActivationEmail(email: string, name: string, plan: string, period: BillingPeriod): Promise<void> {
  await sendMail({
    to: email,
    subject: biSubject(`Lexab: подписка ${plan} активирована`, `Lexab: your ${plan} plan is active`),
    html: mailLayout(
      biLine('Подписка активирована', 'Plan activated'),
      biBody(
        `<p>Здравствуйте, <strong>${escapeMailHtml(name)}</strong>!</p>
       <p>Тариф <strong>${escapeMailHtml(plan)}</strong> (${period === 'yearly' ? 'годовой' : 'месячный'}) активирован.</p>
       <p>Вы подтвердили немедленное начало услуги и отказались от 14-дневного права возврата. Оплата за начатый период не возвращается; при отмене доступ сохраняется до конца оплаченного срока. Ваши законные права потребителя это не затрагивает.</p>`,
        `<p>Hello <strong>${escapeMailHtml(name)}</strong>,</p>
       <p>Your <strong>${escapeMailHtml(plan)}</strong> plan (${period === 'yearly' ? 'yearly' : 'monthly'}) is now active.</p>
       <p>You confirmed that the service starts immediately and waived the 14-day right of withdrawal. Payment for a started period is non-refundable; if you cancel, access remains until the end of the paid term. Your statutory consumer rights are not affected.</p>`,
      ),
      biLine('Управление подпиской', 'Manage subscription'),
      `${config.appBaseUrl}/settings`,
    ),
  });
}

/** Дуннинг-письмо LS-подписки: провайдер сам повторяет списание ~2 недели. */
async function sendLsDunningEmail(email: string, name: string, plan: string): Promise<void> {
  await sendMail({
    to: email,
    subject: biSubject('Lexab: не удалось продлить подписку', 'Lexab: subscription renewal failed'),
    html: mailLayout(
      biLine('Продление не прошло', 'Renewal failed'),
      biBody(
        `<p>Здравствуйте, <strong>${escapeMailHtml(name)}</strong>!</p>
       <p>Платёж за тариф <strong>${escapeMailHtml(plan)}</strong> не прошёл. Доступ пока сохраняется — платёжная система повторит попытку автоматически; обновите способ оплаты в «Управлении оплатой» (Настройки), чтобы не потерять доступ.</p>`,
        `<p>Hello <strong>${escapeMailHtml(name)}</strong>,</p>
       <p>The payment for your <strong>${escapeMailHtml(plan)}</strong> plan failed. Your access remains for now — the payment provider will retry automatically; update your payment method via “Manage billing” in Settings so you do not lose it.</p>`,
      ),
      biLine('Обновить способ оплаты', 'Update payment method'),
      `${config.appBaseUrl}/settings`,
    ),
  });
}

interface WebhookUser {
  id: string;
  email: string;
  name: string;
}

interface HandleOutcome {
  status: 'processed' | 'skipped';
  note?: string;
  userId?: string;
  lsSubscriptionId?: string;
}

/**
 * Конвергентная обработка объекта подписки LS: локальное состояние приводится
 * к состоянию payload'а. Все ветки идемпотентны — порядок доставки событий
 * (created ↔ payment_success ↔ updated) не важен, повторная доставка — no-op.
 */
async function convergeSubscription(db: Db, user: WebhookUser, lsSubId: string, attrs: LsSubscriptionAttributes): Promise<HandleOutcome> {
  const cur = await db.query<{
    plan: string;
    period: string | null;
    status: string;
    renews_at: Date | string | null;
    cancel_at_period_end: boolean;
    ls_subscription_id: string | null;
    ls_variant_id: string | null;
    ls_event_updated_at: Date | string | null;
  }>(
    `SELECT plan, period, status, renews_at, cancel_at_period_end, ls_subscription_id, ls_variant_id, ls_event_updated_at
     FROM subscriptions WHERE user_id = $1`,
    [user.id],
  );
  const row = cur.rows[0];
  const status = String(attrs.status);

  // ЧУЖАЯ подписка: custom_data.user_id вшит в события КАЖДОЙ когда-либо
  // созданной подписки пользователя. Разрушительные события (cancelled/
  // past_due/expired/paused) от подписки, НЕ привязанной к строке, игнорируем —
  // иначе зомби-подписка валит на Free платящего по живой. Событие active
  // другой подписки — осознанный takeover: новая оплаченная подписка вытесняет
  // старую, которую мы best-effort отменяем у LS (защита от двойного списания).
  const foreign = Boolean(row?.ls_subscription_id && row.ls_subscription_id !== lsSubId);
  if (foreign && status !== 'active' && status !== 'on_trial') {
    return { status: 'skipped', note: `foreign subscription ${lsSubId} (linked: ${row?.ls_subscription_id})`, userId: user.id, lsSubscriptionId: lsSubId };
  }
  if (foreign && row?.ls_subscription_id) {
    const oldId = row.ls_subscription_id;
    try {
      await cancelSubscription(oldId);
      await recordBillingEvent(db, { userId: user.id, email: user.email, kind: 'canceled', payload: { reason: 'superseded', old: oldId, by: lsSubId } });
    } catch (err) {
      console.error(`[billing] failed to cancel superseded LS subscription ${oldId} for ${user.email} — MANUAL ACTION NEEDED:`, err instanceof Error ? err.message : err);
    }
  }

  // Монотонный guard (строгое <): событие СТАРШЕ уже применённого — ретрай или
  // перестановка. Равные метки НЕ отбрасываем: LS пишет updated_at с секундной
  // точностью, два разных события в одну секунду реальны, а ветки идемпотентны.
  if (!foreign && row?.ls_event_updated_at && attrs.updated_at && new Date(attrs.updated_at) < new Date(row.ls_event_updated_at)) {
    return { status: 'skipped', note: 'stale updated_at', userId: user.id, lsSubscriptionId: lsSubId };
  }

  const base: HandleOutcome = { status: 'processed', userId: user.id, lsSubscriptionId: lsSubId };
  const ls = { customerId: String(attrs.customer_id), subscriptionId: lsSubId, variantId: String(attrs.variant_id) };

  if (status === 'active' || status === 'on_trial') {
    const mapped = variantToPlan(attrs.variant_id);
    // Неизвестный variant = рассинхрон env с дашбордом LS. Бросаем — роут
    // ответит 5xx, LS будет ретраить, resend из дашборда добьёт после фикса.
    if (!mapped) throw new Error(`unknown Lemon Squeezy variant ${attrs.variant_id}`);
    const firstActivation = !row || row.plan === 'Free';
    const planChanged = !row || row.plan !== mapped.plan || String(row.ls_variant_id ?? '') !== String(attrs.variant_id);
    const renewsAdvanced = Boolean(
      row?.renews_at && attrs.renews_at && new Date(attrs.renews_at).getTime() > new Date(row.renews_at).getTime(),
    );
    if (planChanged) {
      await activatePlan(db, user.id, user.email, mapped.plan, mapped.period, { renewsAt: attrs.renews_at, ls });
      if (firstActivation) {
        await notify(db, user.id, 'check', 'Подписка активирована', 'Plan activated', {
          bodyRu: `${mapped.plan} · ${mapped.period === 'yearly' ? 'годовая' : 'месячная'} · лимиты обновлены`,
          bodyEn: `${mapped.plan} · ${mapped.period} · limits refreshed`,
          action: { kind: 'open', data: '/settings' },
        });
        void sendActivationEmail(user.email, user.name, mapped.plan, mapped.period);
      }
    } else if (renewsAdvanced || row.status !== 'active') {
      await renewSubscription(db, user.id, user.email, mapped.plan, mapped.period, { renewsAt: attrs.renews_at });
    }
    // Возобновление после отмены: LS прислал active без ends_at, а у нас висит флаг.
    if (row?.cancel_at_period_end && !attrs.ends_at) {
      const changed = await setCancelAtPeriodEnd(db, user.id, user.email, false);
      if (changed) await recordBillingEvent(db, { userId: user.id, email: user.email, kind: 'resumed', plan: mapped.plan });
    }
  } else if (status === 'cancelled') {
    // Перестановка cancelled→created (created упал 5xx и уехал в ретрай):
    // cancelled сам по себе значит «ОПЛАЧЕНА до ends_at» — конвергируем полное
    // состояние, а не только флаг, иначе оплаченная активация теряется.
    const mapped = variantToPlan(attrs.variant_id);
    const endsInFuture = Boolean(attrs.ends_at && new Date(attrs.ends_at).getTime() > Date.now());
    if (mapped && endsInFuture && (!row || row.plan !== mapped.plan)) {
      await activatePlan(db, user.id, user.email, mapped.plan, mapped.period, { renewsAt: attrs.ends_at, ls });
    }
    await setCancelAtPeriodEnd(db, user.id, user.email, true);
    if (attrs.ends_at) {
      await db.query('UPDATE subscriptions SET renews_at = $2 WHERE user_id = $1', [user.id, attrs.ends_at]);
    }
  } else if (status === 'past_due' || status === 'unpaid') {
    if (row && row.plan !== 'Free' && row.status !== 'past_due') {
      const changed = await markPastDue(db, user.id, user.email, row.plan);
      if (changed) void sendLsDunningEmail(user.email, user.name, row.plan);
    }
  } else if (status === 'expired') {
    if (row && row.plan !== 'Free') {
      await downgradeToFree(db, user.id, user.email, 'past_due', { clearProviderLink: true });
    }
  } else if (status === 'paused') {
    // Пауза платежей: доступ до конца оплаченного периода, продления не будет —
    // ровно семантика cancel_at_period_end; unpause придёт статусом active.
    await setCancelAtPeriodEnd(db, user.id, user.email, true);
  } else {
    return { ...base, status: 'skipped', note: `unhandled status ${status}` };
  }

  // Guard-отметка ПОСЛЕ успешного применения. GREATEST — параллельный вебхук
  // не откатит метку назад; ls-id не перепривязываем для expired
  // (downgradeToFree их только что очистил — мёртвую подписку не воскрешаем).
  await db.query(
    `UPDATE subscriptions
     SET ls_event_updated_at = GREATEST(COALESCE(ls_event_updated_at, '-infinity'::timestamptz), $2::timestamptz),
         ls_customer_id = COALESCE(ls_customer_id, $3)
     WHERE user_id = $1`,
    [user.id, attrs.updated_at ?? new Date().toISOString(), String(attrs.customer_id ?? '') || null],
  );
  return base;
}

/** Разбор события LS → пользователь → нужный обработчик. */
async function handleLemonSqueezyEvent(db: Db, eventName: string, payload: Record<string, unknown>): Promise<HandleOutcome> {
  const data = asObject((payload.data as object | undefined) ?? {});
  const attrs = (data.attributes ?? {}) as LsSubscriptionAttributes & { subscription_id?: number | string; test_mode?: boolean };
  const meta = asObject((payload.meta as object | undefined) ?? {});
  const custom = asObject((meta.custom_data as object | undefined) ?? {});

  // Live-режим не принимает тестовые события (тест-режим включается явным
  // LEMONSQUEEZY_TEST_MODE=1 на Этапе A).
  if (attrs.test_mode === true && !config.lemonSqueezy.acceptTestEvents) {
    return { status: 'skipped', note: 'test_mode event in live config' };
  }

  const isSubscriptionEvent = eventName.startsWith('subscription_') && !eventName.startsWith('subscription_payment_');
  const lsSubId = isSubscriptionEvent
    ? String(data.id ?? '')
    : attrs.subscription_id !== undefined
      ? String(attrs.subscription_id)
      : '';

  // Пользователь: сначала наш user_id из checkout custom_data, затем — по
  // сохранённой привязке ls_subscription_id.
  let user: WebhookUser | null = null;
  const customUserId = typeof custom.user_id === 'string' || typeof custom.user_id === 'number' ? String(custom.user_id) : '';
  if (customUserId) {
    const u = await db.query<WebhookUser>('SELECT id, email, name FROM users WHERE id = $1', [customUserId]);
    user = u.rows[0] ?? null;
  }
  if (!user && lsSubId) {
    const u = await db.query<WebhookUser>(
      `SELECT u.id, u.email, u.name FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.ls_subscription_id = $1`,
      [lsSubId],
    );
    user = u.rows[0] ?? null;
  }
  // Ретраи «неизвестного пользователя» не починят (аккаунт удалён) — 200 skip.
  if (!user) return { status: 'skipped', note: 'unknown user', lsSubscriptionId: lsSubId || undefined };

  switch (eventName) {
    case 'order_created':
      // Заказ предшествует subscription_created — самостоятельной обработки нет.
      return { status: 'processed', note: 'order journaled', userId: user.id, lsSubscriptionId: lsSubId || undefined };
    case 'order_refunded':
    case 'subscription_payment_refunded': {
      await recordBillingEvent(db, { userId: user.id, email: user.email, kind: 'refunded', payload: { event: eventName } });
      // Возврат НЕ отзывает доступ автоматически (политика оператора), но и
      // молчать нельзя: возврат при живом платном плане = бесплатный доступ.
      const cur = await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [user.id]);
      if (cur.rows[0] && cur.rows[0].plan !== 'Free' && config.contactEmail) {
        void sendMail({
          to: config.contactEmail,
          subject: `Lexab: возврат платежа при активном плане ${cur.rows[0].plan}`,
          html: mailLayout(
            'Возврат платежа',
            `<p>${escapeMailHtml(eventName)} для ${escapeMailHtml(user.email)} — план <strong>${escapeMailHtml(cur.rows[0].plan)}</strong> остаётся активным. Проверьте в дашборде Lemon Squeezy, нужно ли отменить подписку.</p>`,
          ),
        });
        const founder = await getUserByEmail(db, config.contactEmail.toLowerCase());
        if (founder) {
          await notify(db, founder.id, 'docs', 'Возврат платежа', 'Payment refunded', {
            bodyRu: `${user.email} · план ${cur.rows[0].plan} активен — проверить подписку в LS`,
            bodyEn: `${user.email} · ${cur.rows[0].plan} still active — check the LS subscription`,
          });
        }
      }
      return { status: 'processed', userId: user.id, lsSubscriptionId: lsSubId || undefined };
    }
    case 'subscription_payment_failed':
    case 'subscription_payment_success':
    case 'subscription_payment_recovered': {
      // Invoice-события не несут variant/renews_at — забираем свежую подписку
      // из API и конвергируем по ПРАВДЕ провайдера (в тестах fetch замокан).
      // Для payment_failed это ещё и защита от запоздавшего даннинга: если LS
      // уже восстановил платёж (status=active), past_due не ставится вовсе.
      if (!lsSubId) return { status: 'skipped', note: 'invoice without subscription_id', userId: user.id };
      const sub = await getSubscription(lsSubId);
      return convergeSubscription(db, user, sub.id, sub.attributes);
    }
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_cancelled':
    case 'subscription_resumed':
    case 'subscription_expired':
    case 'subscription_paused':
    case 'subscription_unpaused':
      return convergeSubscription(db, user, lsSubId, attrs);
    default:
      return { status: 'skipped', note: `unhandled event ${eventName}`, userId: user.id, lsSubscriptionId: lsSubId || undefined };
  }
}

/**
 * POST /billing/webhook — приёмник Lemon Squeezy. Инкапсулированный scope:
 * content-type parser отдаёт СЫРОЙ Buffer только этому роуту (HMAC считается
 * от байтов тела; глобальный JSON-парсинг остальных роутов не затронут).
 */
function registerLemonSqueezyWebhook(app: FastifyInstance, db: Db): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    // Без rate-limit: события идут с малого пула IP Lemon Squeezy — залп
    // ретраев/resend не должен упираться в 429 и терять оплаченные активации;
    // подлинность гарантирует HMAC-подпись.
    scope.post('/billing/webhook', { config: { rateLimit: false } }, async (req, reply) => {
      if (!lemonSqueezyEnabled()) {
        reply.code(404);
        return { error: 'not configured' };
      }
      const raw = req.body as Buffer;
      const signature = String(req.headers['x-signature'] ?? '');
      if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, signature)) {
        // 401: если secret рассинхронизирован, ретраи LS доставят события после фикса.
        reply.code(401);
        return { error: 'bad signature' };
      }
      let payload: Record<string, unknown>;
      try {
        payload = asObject(JSON.parse(raw.toString('utf8')));
      } catch {
        reply.code(400);
        return { error: 'bad json' };
      }
      const meta = asObject((payload.meta as object | undefined) ?? {});
      const eventName = String(meta.event_name ?? req.headers['x-event-name'] ?? 'unknown').slice(0, 80);
      const bodySha = crypto.createHash('sha256').update(raw).digest('hex');

      // Дедуп по SHA-256 сырого тела (ретраи LS шлют байт-в-байт то же тело).
      // Упавшие ('error') строки НЕ считаются обработанными — ретрай их добьёт.
      let journalId = newId('lswh');
      const ins = await db.query<{ id: string }>(
        `INSERT INTO ls_webhook_events (id, event_name, body_sha256, status, error, payload)
         VALUES ($1, $2, $3, 'error', 'in-flight', $4)
         ON CONFLICT (body_sha256) DO NOTHING RETURNING id`,
        [journalId, eventName, bodySha, JSON.stringify(payload)],
      );
      if (ins.rows.length === 0) {
        // Повторное тело. Успешно обработанное — дубликат. Упавшее — ретрай
        // обрабатывает заново, НО параллельную обработку того же тела (LS-ретрай
        // наложился на медленный первый запрос) не пускаем: claim через
        // условный UPDATE — «занято», пока error='in-flight' моложе 5 минут.
        const claim = await db.query<{ id: string }>(
          `UPDATE ls_webhook_events SET error = 'in-flight', created_at = now()
           WHERE body_sha256 = $1 AND status = 'error'
             AND (error IS DISTINCT FROM 'in-flight' OR created_at < now() - interval '5 minutes')
           RETURNING id`,
          [bodySha],
        );
        if (claim.rows.length === 0) return { ok: true, duplicate: true };
        journalId = claim.rows[0].id;
      }

      try {
        const outcome = await handleLemonSqueezyEvent(db, eventName, payload);
        await db.query(
          `UPDATE ls_webhook_events SET status = $2, error = NULL, user_id = $3, ls_subscription_id = $4 WHERE id = $1`,
          [journalId, outcome.status, outcome.userId ?? null, outcome.lsSubscriptionId ?? null],
        );
        return { ok: true, status: outcome.status, ...(outcome.note ? { note: outcome.note } : {}) };
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
        req.log.error({ err, eventName }, 'lemonsqueezy webhook: processing failed');
        await db.query(`UPDATE ls_webhook_events SET status = 'error', error = $2 WHERE id = $1`, [journalId, message]);
        reply.code(500);
        return { error: 'processing failed' };
      }
    });
  });
}
