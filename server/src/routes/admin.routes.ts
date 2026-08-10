/**
 * Админ-панель владельца: выдача тарифов и персональных лимитов.
 *
 * ЕДИНСТВЕННЫЙ путь получить платный тариф в продукте (платёжного провайдера
 * нет — см. lib/billing.ts). Каждый обработчик начинается с assertAdmin: гейт
 * живёт на сервере, потому что скрытая страница ничего не закрывает.
 *
 * Всё, что меняет чужой аккаунт, пишется в журнал действий (audit) и в
 * billing_events — через месяц иначе не вспомнить, кому и за что открыт
 * Business, а без следа выдача платного доступа неотличима от взлома.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { toIso } from '../lib/format.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import { assertAdmin } from '../lib/adminAuth.ts';
import { audit } from '../lib/audit.ts';
import { activatePlan, downgradeToFree, recordBillingEvent, type BillingPeriod } from '../lib/billing.ts';
import { effectiveLimits, monthlyUsage, PLAN_LIMITS, PLAN_SEATS, planFor, storageUsedBytes } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { config } from '../config.ts';

const GRANTABLE_PLANS = ['Free', 'Standard', 'Pro', 'Business', 'Enterprise'];

/** Поля персональных лимитов: имя в API → колонка в базе. */
const LIMIT_FIELDS = {
  ai: 'ai',
  docs: 'docs',
  storageMb: 'storage_mb',
  seats: 'seats',
  apiMonthly: 'api_monthly',
} as const;
type LimitField = keyof typeof LIMIT_FIELDS;

/**
 * Разбор значения лимита из тела запроса:
 *   число ≥ 0   → жёсткое значение,
 *   'unlimited' → -1 (без ограничения),
 *   null        → снять переопределение (вернуться к тарифу),
 *   поля нет    → не трогать.
 */
function parseLimit(raw: unknown, field: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (raw === 'unlimited' || raw === -1 || raw === '-1') return -1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
    throw new HttpError(400, `Лимит «${field}» должен быть целым числом ≥ 0, «unlimited» или null.`);
  }
  return n;
}

const RATE = { rateLimit: { max: 30, timeWindow: '1 minute' } };

export function adminRoutes(app: FastifyInstance, db: Db): void {
  /** Есть ли у текущего пользователя доступ к панели (фронт прячет пункт меню). */
  app.get('/admin/whoami', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    return { admin: true, email: req.currentUser.email, plans: GRANTABLE_PLANS };
  });

  /** Сводка: сколько аккаунтов, по тарифам, сколько выдач за 30 дней. */
  app.get('/admin/stats', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const byPlan = await db.query<{ plan: string; n: string | number }>(
      `SELECT COALESCE(s.plan, 'Free') AS plan, count(*) AS n
       FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
       GROUP BY 1 ORDER BY 1`,
    );
    const totals = await db.query<{ users: string | number; overrides: string | number; grants30: string | number }>(
      `SELECT (SELECT count(*) FROM users) AS users,
              (SELECT count(*) FROM user_limit_overrides) AS overrides,
              (SELECT count(*) FROM billing_events WHERE kind = 'granted' AND created_at > now() - interval '30 days') AS grants30`,
    );
    const t = totals.rows[0];
    return {
      users: Number(t?.users ?? 0),
      customLimits: Number(t?.overrides ?? 0),
      grantsLast30Days: Number(t?.grants30 ?? 0),
      byPlan: byPlan.rows.map((r) => ({ plan: r.plan, count: Number(r.n) })),
    };
  });

  /** Поиск аккаунтов по почте/имени/фирме. */
  app.get('/admin/users', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const q = String((req.query as Record<string, unknown> | undefined)?.q ?? '').trim().slice(0, 200);
    const rows = await db.query<{
      id: string;
      email: string;
      name: string;
      firm: string | null;
      created_at: Date | string;
      plan: string | null;
      status: string | null;
      renews_at: Date | string | null;
      grant_note: string | null;
      has_overrides: boolean;
    }>(
      `SELECT u.id, u.email, u.name, u.firm, u.created_at,
              s.plan, s.status, s.renews_at, s.grant_note,
              (o.user_id IS NOT NULL) AS has_overrides
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       LEFT JOIN user_limit_overrides o ON o.user_id = u.id
       WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%' OR COALESCE(u.firm,'') ILIKE '%' || $1 || '%')
       ORDER BY u.created_at DESC
       LIMIT 50`,
      [q],
    );
    return {
      users: rows.rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        firm: r.firm,
        createdAt: toIso(r.created_at),
        plan: r.plan ?? 'Free',
        status: r.status ?? 'active',
        renewsAt: r.renews_at ? toIso(r.renews_at) : null,
        grantNote: r.grant_note,
        hasCustomLimits: Boolean(r.has_overrides),
      })),
    };
  });

  /** Карточка аккаунта: тариф, действующие лимиты, расход, история выдач. */
  app.get('/admin/users/:id', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const { id } = req.params as { id: string };
    const u = await db.query<{ id: string; email: string; name: string; firm: string | null; created_at: Date | string }>(
      'SELECT id, email, name, firm, created_at FROM users WHERE id = $1',
      [id],
    );
    const user = u.rows[0];
    if (!user) throw notFound('Пользователь не найден');

    const plan = await planFor(db, id);
    const [limits, usage, storageBytes] = await Promise.all([
      effectiveLimits(db, id, plan),
      monthlyUsage(db, id),
      storageUsedBytes(db, id),
    ]);
    const sub = await db.query<{ status: string; period: string | null; renews_at: Date | string | null; granted_by: string | null; grant_note: string | null }>(
      'SELECT status, period, renews_at, granted_by, grant_note FROM subscriptions WHERE user_id = $1',
      [id],
    );
    const history = await db.query<{ kind: string; plan: string | null; payload: Record<string, unknown>; created_at: Date | string }>(
      `SELECT kind, plan, payload, created_at FROM billing_events
       WHERE user_id = $1 AND kind IN ('granted', 'revoked', 'downgraded', 'canceled', 'limits_changed')
       ORDER BY created_at DESC LIMIT 25`,
      [id],
    );
    const s = sub.rows[0];
    return {
      user: { id: user.id, email: user.email, name: user.name, firm: user.firm, createdAt: toIso(user.created_at) },
      subscription: {
        plan,
        status: s?.status ?? 'active',
        period: s?.period ?? null,
        renewsAt: s?.renews_at ? toIso(s.renews_at) : null,
        grantedBy: s?.granted_by ?? null,
        grantNote: s?.grant_note ?? null,
      },
      // planLimits — что даёт тариф; limits — что реально применяется.
      planLimits: {
        ai: (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).ai,
        docs: (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).docs,
        storageMb: (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free).storageMb,
        seats: PLAN_SEATS[plan] ?? PLAN_SEATS.Free,
        apiMonthly: plan === 'Enterprise' ? null : config.apiMonthlyLimit,
      },
      limits,
      usage: {
        aiRequests: usage.aiRequests,
        documents: usage.docsCreated,
        storageMb: Math.round((storageBytes / (1024 * 1024)) * 10) / 10,
      },
      history: history.rows.map((h) => ({
        kind: h.kind,
        plan: h.plan,
        payload: h.payload,
        at: toIso(h.created_at),
      })),
    };
  });

  /**
   * Выдать/продлить тариф. Срок задаётся месяцами (months) либо точной датой
   * (until, ISO). Free выдаётся как отзыв доступа.
   */
  app.post('/admin/users/:id/plan', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const { id } = req.params as { id: string };
    const body = asObject(req.body ?? {});
    const plan = requireString(body, 'plan', { min: 1, max: 40 });
    if (!GRANTABLE_PLANS.includes(plan)) {
      throw new HttpError(400, `Тариф должен быть одним из: ${GRANTABLE_PLANS.join(', ')}`);
    }
    const note = optionalString(body, 'note', { max: 500 }) ?? null;
    const target = await db.query<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = $1', [id]);
    const user = target.rows[0];
    if (!user) throw notFound('Пользователь не найден');

    if (plan === 'Free') {
      const changed = await downgradeToFree(db, id, user.email, 'revoked');
      await recordBillingEvent(db, {
        userId: id,
        email: user.email,
        kind: 'revoked',
        plan: 'Free',
        payload: { by: req.currentUser.email, note },
      });
      await audit(db, req, { type: 'admin.plan_granted', teamOwnerId: id, metadata: { plan: 'Free', revoked: true, note } });
      return { ok: true, plan: 'Free', changed, renewsAt: null };
    }

    const period: BillingPeriod = body.period === 'yearly' ? 'yearly' : 'monthly';
    // months имеет приоритет над period при расчёте даты окончания: владелец
    // чаще думает «дал на 3 месяца», а не «месячный/годовой цикл».
    const months = body.months === undefined || body.months === null ? null : Number(body.months);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) {
      throw new HttpError(400, 'Срок в месяцах должен быть целым числом от 1 до 120.');
    }
    let renewsAt: string | null = null;
    const untilRaw = optionalString(body, 'until', { max: 40 });
    if (untilRaw) {
      const d = new Date(untilRaw);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Дата окончания задана неверно.');
      if (d.getTime() <= Date.now()) throw new HttpError(400, 'Дата окончания должна быть в будущем.');
      renewsAt = d.toISOString();
    } else if (months !== null) {
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      renewsAt = d.toISOString();
    }

    const res = await activatePlan(db, id, user.email, plan, period, {
      renewsAt,
      grantedBy: req.currentUser.email,
      note,
    });
    await audit(db, req, {
      type: 'admin.plan_granted',
      teamOwnerId: id,
      metadata: { plan, period, months, until: renewsAt, note },
    });
    await notify(db, id, 'check', 'Тариф подключён', 'Plan activated', {
      bodyRu: `${plan} · доступ открыт${res.renewsAt ? ` до ${new Date(res.renewsAt).toLocaleDateString('ru-RU')}` : ''}`,
      bodyEn: `${plan} · access enabled${res.renewsAt ? ` until ${new Date(res.renewsAt).toLocaleDateString('en-GB')}` : ''}`,
      action: { kind: 'open', data: '/settings' },
    });
    void sendMail({
      to: user.email,
      subject: biSubject(`Lexab: тариф ${plan} подключён`, `Lexab: your ${plan} plan is active`),
      html: mailLayout(
        biLine('Тариф подключён', 'Plan activated'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(user.name)}</strong>!</p>
           <p>Мы открыли на вашем аккаунте тариф <strong>${escapeMailHtml(plan)}</strong>${
             res.renewsAt ? ` — доступ действует до <strong>${new Date(res.renewsAt).toLocaleDateString('ru-RU')}</strong>` : ''
           }.</p>
           <p>Если понадобится изменить условия — просто напишите нам.</p>`,
          `<p>Hello <strong>${escapeMailHtml(user.name)}</strong>,</p>
           <p>We have enabled the <strong>${escapeMailHtml(plan)}</strong> plan on your account${
             res.renewsAt ? ` — access runs until <strong>${new Date(res.renewsAt).toLocaleDateString('en-GB')}</strong>` : ''
           }.</p>
           <p>Need different terms? Just message us.</p>`,
        ),
        biLine('Открыть Lexab', 'Open Lexab'),
        `${config.appBaseUrl}/settings`,
      ),
    });
    return { ok: true, plan, period, renewsAt: res.renewsAt };
  });

  /**
   * Персональные лимиты. Тело — любые из полей ai/docs/storageMb/seats/
   * apiMonthly: число, 'unlimited' или null (снять переопределение).
   * Отсутствующее поле не трогается.
   */
  app.put('/admin/users/:id/limits', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const { id } = req.params as { id: string };
    const body = asObject(req.body ?? {});
    const target = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
    const user = target.rows[0];
    if (!user) throw notFound('Пользователь не найден');
    const note = optionalString(body, 'note', { max: 500 }) ?? null;

    const patch: Partial<Record<LimitField, number | null>> = {};
    for (const field of Object.keys(LIMIT_FIELDS) as LimitField[]) {
      const v = parseLimit(body[field], field);
      if (v !== undefined) patch[field] = v;
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Не передано ни одного лимита.');

    // Одна строка на пользователя: UPSERT с точечным обновлением переданных
    // колонок. COALESCE НЕ используем — null здесь означает «снять
    // переопределение», а не «не менять» (это разные вещи, см. parseLimit).
    const cols = Object.keys(patch).map((f) => LIMIT_FIELDS[f as LimitField]);
    const values = Object.values(patch);
    const placeholders = cols.map((_, i) => `$${i + 2}`);
    const updates = cols.map((c, i) => `${c} = $${i + 2}`);
    await db.query(
      `INSERT INTO user_limit_overrides (user_id, ${cols.join(', ')}, note, set_by, updated_at)
       VALUES ($1, ${placeholders.join(', ')}, $${cols.length + 2}, $${cols.length + 3}, now())
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')},
             note = $${cols.length + 2}, set_by = $${cols.length + 3}, updated_at = now()`,
      [id, ...values, note, req.currentUser.email],
    );

    // Строка без единого переопределения — мусор: удаляем, чтобы «сброшено»
    // и «задано, но равно тарифу» не выглядели одинаково в списке.
    await db.query(
      `DELETE FROM user_limit_overrides
       WHERE user_id = $1 AND ai IS NULL AND docs IS NULL AND storage_mb IS NULL
         AND seats IS NULL AND api_monthly IS NULL`,
      [id],
    );

    await recordBillingEvent(db, {
      userId: id,
      email: user.email,
      kind: 'limits_changed',
      payload: { by: req.currentUser.email, note, patch },
    });
    await audit(db, req, { type: 'admin.limits_changed', teamOwnerId: id, metadata: { limits: patch, note } });

    const plan = await planFor(db, id);
    return { ok: true, limits: await effectiveLimits(db, id, plan) };
  });

  /** Снять ВСЕ персональные лимиты (вернуть тарифные). */
  app.delete('/admin/users/:id/limits', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const { id } = req.params as { id: string };
    const target = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
    const user = target.rows[0];
    if (!user) throw notFound('Пользователь не найден');
    await db.query('DELETE FROM user_limit_overrides WHERE user_id = $1', [id]);
    await recordBillingEvent(db, {
      userId: id,
      email: user.email,
      kind: 'limits_changed',
      payload: { by: req.currentUser.email, reset: true },
    });
    await audit(db, req, { type: 'admin.limits_changed', teamOwnerId: id, metadata: { reset: true } });
    const plan = await planFor(db, id);
    return { ok: true, limits: await effectiveLimits(db, id, plan) };
  });

  /** Обнулить счётчики расхода текущего месяца (подарить квоту заново). */
  app.post('/admin/users/:id/usage/reset', { preHandler: [app.authenticate], config: RATE }, async (req) => {
    assertAdmin(req);
    const { id } = req.params as { id: string };
    const target = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
    if (!target.rows[0]) throw notFound('Пользователь не найден');
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created, api_requests)
       VALUES ($1, date_trunc('month', now())::date, 0, 0, 0)
       ON CONFLICT (user_id, month) DO UPDATE SET ai_requests = 0, docs_created = 0, api_requests = 0`,
      [id],
    );
    await audit(db, req, { type: 'admin.usage_reset', teamOwnerId: id, metadata: {} });
    return { ok: true, usage: await monthlyUsage(db, id) };
  });
}
