/**
 * Биллинг: подписка, лимиты, заявка в Enterprise, отмена.
 *
 * ПЛАТЁЖНОГО САМООБСЛУЖИВАНИЯ В ПРОДУКТЕ НЕТ (решение владельца 2026-08-06).
 * Lemon Squeezy отклонил верификацию магазина, интеграция удалена целиком —
 * вместе с ней ушёл и BILLING_FALLBACK=dev, который раздавал платные тарифы
 * бесплатно всякому, кто нажмёт кнопку.
 *
 * Платный тариф теперь появляется РОВНО ОДНИМ способом: владелец выдаёт его в
 * админ-панели (admin.routes.ts). Ни один маршрут этого файла тариф не
 * повышает — /billing/checkout отвечает 402 и отправляет к менеджеру. Это не
 * временная заглушка, а свойство продукта: пока нет провайдера, любая кнопка
 * «купить» в клиентском API была бы дырой в бесплатную выдачу.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { toIso } from '../lib/format.ts';
import { notify } from '../lib/notify.ts';
import { asObject } from '../lib/validate.ts';
import { DOC_COST, effectiveLimits, monthlyUsage, planFor, storageUsedBytes } from '../lib/limits.ts';
import { config } from '../config.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import { setCancelAtPeriodEnd } from '../lib/billing.ts';

export function billingRoutes(app: FastifyInstance, db: Db): void {
  app.get('/billing/subscription', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{
      plan: string;
      period: string | null;
      status: string;
      renews_at: Date | string | null;
      cancel_at_period_end: boolean;
      source: string;
    }>(
      'SELECT plan, period, status, renews_at, cancel_at_period_end, source FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = res.rows[0] ?? {
      plan: 'Free',
      period: null,
      status: 'active',
      renews_at: null,
      cancel_at_period_end: false,
      source: 'manual',
    };
    return {
      plan: row.plan,
      period: row.period,
      status: row.status,
      renewsAt: row.renews_at ? toIso(row.renews_at) : null,
      periodEnd: row.renews_at ? toIso(row.renews_at) : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      // Портала покупателя нет: провайдера нет. Поле сохранено, чтобы старый
      // фронт не падал на его отсутствии, и всегда null.
      provider: null,
      source: row.source,
    };
  });

  // Current usage vs the account's EFFECTIVE limits (plan + персональные
  // надбавки из админ-панели) — те же числа, что применяет сам гейт.
  app.get('/billing/limits', { preHandler: [app.authenticate] }, async (req) => {
    const userId = req.currentUser.id;
    const [plan, usage, storageBytes] = await Promise.all([
      planFor(db, userId),
      monthlyUsage(db, userId),
      storageUsedBytes(db, userId),
    ]);
    const limits = await effectiveLimits(db, userId, plan);

    return {
      plan,
      aiRequests: { used: usage.aiRequests, limit: limits.ai },
      documents: { used: usage.docsCreated, limit: limits.docs },
      storageMb: { used: Math.round((storageBytes / (1024 * 1024)) * 10) / 10, limit: limits.storageMb },
      // Персональные лимиты подписываются в интерфейсе честно: человек должен
      // понимать, почему у него не как на странице тарифов.
      customLimits: limits.overridden,
      // Во сколько единиц лимита ДОКУМЕНТОВ обходится операция. Отдаём с
      // сервера, а не дублируем во фронте: разъехавшись, эти числа врали бы
      // человеку о его же остатке. Лимит ИИ-запросов — только чат, стоимость 1.
      docCosts: DOC_COST,
      // Рантайм-флаги разделов: интерфейс не должен предлагать то, что сервер
      // всё равно отклонит. Э-подписи закрыты до подключения E-IMZO.
      features: { esign: config.esignEnabled },
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

  /**
   * Покупка тарифа из клиента НЕВОЗМОЖНА. Маршрут оставлен намеренно, чтобы
   * старые клиенты и закладки получали внятный ответ, а не 404 — но он не
   * трогает подписку ни при каких входных данных.
   */
  app.post('/billing/checkout', { preHandler: [app.authenticateReal] }, async () => {
    throw new HttpError(
      402,
      'Тариф подключает менеджер: напишите нам, и мы откроем доступ на вашем аккаунте. / Plans are activated by our team — message us and we will enable it on your account.',
      'manual_billing',
    );
  });

  // Отмена: доступ сохраняется до конца оплаченного периода. Провайдера нет,
  // поэтому вся отмена — локальная запись.
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
