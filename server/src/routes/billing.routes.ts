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
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { getUserByEmail } from '../plugins/auth.ts';

const KNOWN_PLANS = ['Free', 'Standard', 'Pro', 'Business'];

export function billingRoutes(app: FastifyInstance, db: Db): void {
  app.get('/billing/subscription', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ plan: string; status: string; renews_at: Date | string | null }>(
      'SELECT plan, status, renews_at FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = res.rows[0] ?? { plan: 'Free', status: 'active', renews_at: null };
    return { plan: row.plan, status: row.status, renewsAt: row.renews_at ? toIso(row.renews_at) : null };
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

  // Purchase / renew a plan. PRE-STRIPE: activation is immediate — when Stripe
  // arrives, its payment step slots in front of this same activation logic
  // (webhook → activatePlan). Buying (again) starts a fresh billing period:
  // the current month's counters reset, so "докупить лимиты" works.
  app.post('/billing/checkout', { preHandler: [app.authenticateReal] }, async (req) => {
    const body = asObject(req.body);
    const plan = requireString(body, 'plan', { min: 1, max: 50 });
    const normalized = KNOWN_PLANS.find((p) => p.toLowerCase() === plan.toLowerCase());
    if (!normalized) throw new HttpError(400, `План должен быть одним из: ${KNOWN_PLANS.join(', ')}`);
    const period = body.period === 'yearly' ? 'yearly' : 'monthly';
    const discountPercent = period === 'yearly' ? 15 : 0;

    await db.query(
      `INSERT INTO subscriptions (user_id, plan, status, period, renews_at)
       VALUES ($1, $2, 'active', $3, now() + ($4)::interval)
       ON CONFLICT (user_id)
       DO UPDATE SET plan = $2, status = 'active', period = $3, renews_at = now() + ($4)::interval`,
      [req.currentUser.id, normalized, period, period === 'yearly' ? '1 year' : '1 month'],
    );
    // Fresh purchase = fresh quota for the current month.
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
       VALUES ($1, date_trunc('month', now())::date, 0, 0)
       ON CONFLICT (user_id, month) DO UPDATE SET ai_requests = 0, docs_created = 0`,
      [req.currentUser.id],
    );
    await notify(db, req.currentUser.id, 'check', 'Подписка активирована', 'Plan activated', {
      bodyRu: `${normalized} · ${period === 'yearly' ? 'годовая' : 'месячная'} · лимиты обновлены`,
      bodyEn: `${normalized} · ${period} · limits refreshed`,
      action: { kind: 'open', data: '/settings' },
    });

    const renews = await db.query<{ renews_at: Date | string }>(
      'SELECT renews_at FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    return {
      ok: true,
      plan: normalized,
      period,
      discountPercent,
      renewsAt: renews.rows[0]?.renews_at ? toIso(renews.rows[0].renews_at) : null,
    };
  });
}
