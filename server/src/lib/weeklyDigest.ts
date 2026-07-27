/**
 * Понедельничная сводка на почту: что ждёт согласования, кто не подписал,
 * какие договоры истекают в ближайшие 30 дней, сколько лимита израсходовано.
 *
 * Продукт используется «вспышками» (договоры приходят пачками) — сводка
 * возвращает задремавшие аккаунты ДО того, как они упрутся в просроченный
 * дедлайн. Пустую сводку не шлём: письмо уходит только когда есть хоть один
 * содержательный сигнал.
 *
 * Выключатель — users.weekly_digest (тумблер в Настройках). Дедуп повторной
 * отправки в тот же понедельник при рестартах — users.digest_sent_at.
 */
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { monthlyUsage, PLAN_LIMITS, planFor } from './limits.ts';

/** Собрать по агрегату «uid → count» одним запросом (без N+1 по пользователям). */
async function countsBy(db: Db, sql: string): Promise<Map<string, number>> {
  const res = await db.query<{ uid: string; n: string | number }>(sql);
  return new Map(res.rows.map((r) => [r.uid, Number(r.n)]));
}

export async function sendWeeklyDigests(db: Db, opts: { force?: boolean } = {}): Promise<number> {
  // Задача зарегистрирована с суточным тиком — день недели проверяем здесь,
  // чтобы регистрация в index.ts осталась однострочной. force — для проверок.
  if (!opts.force && new Date().getDay() !== 1) return 0;

  const users = await db.query<{ id: string; email: string; name: string }>(
    `SELECT id, email, name FROM users
     WHERE email_verified = true AND weekly_digest = true
       AND (digest_sent_at IS NULL OR digest_sent_at < now() - interval '6 days')`,
  );
  if (!users.rows.length) return 0;

  const approvals = await countsBy(
    db,
    `SELECT f.owner_user_id AS uid, count(*) AS n
     FROM approval_steps s JOIN approval_flows f ON f.id = s.flow_id AND f.status = 'active'
     WHERE s.status = 'pending' GROUP BY 1`,
  );
  const signatures = await countsBy(
    db,
    `SELECT q.user_id AS uid, count(*) AS n
     FROM signature_recipients r JOIN signature_requests q ON q.id = r.request_id AND q.status IN ('Sent', 'Viewed')
     WHERE r.signed = false GROUP BY 1`,
  );
  const expiring = await countsBy(
    db,
    `SELECT d.user_id AS uid, count(*) AS n
     FROM contract_terms ct JOIN documents d ON d.id = ct.document_id AND d.deleted_at IS NULL
     WHERE ct.expiry_date IS NOT NULL AND ct.expiry_date >= CURRENT_DATE AND ct.expiry_date <= CURRENT_DATE + 30
     GROUP BY 1`,
  );

  let sent = 0;
  for (const u of users.rows) {
    // Отметка ставится ДО отправки и даже для «пустых» пользователей — иначе
    // рестарт в понедельник прогонял бы всех заново.
    await db.query('UPDATE users SET digest_sent_at = now() WHERE id = $1', [u.id]);

    const nAppr = approvals.get(u.id) ?? 0;
    const nSign = signatures.get(u.id) ?? 0;
    const nExp = expiring.get(u.id) ?? 0;
    if (nAppr === 0 && nSign === 0 && nExp === 0) continue;

    // Русский и английский блоки строятся из ОДНИХ и тех же цифр.
    const items: string[] = [];
    const itemsEn: string[] = [];
    if (nAppr > 0) {
      items.push(`<li>Ждут согласования: <strong>${nAppr}</strong></li>`);
      itemsEn.push(`<li>Awaiting approval: <strong>${nAppr}</strong></li>`);
    }
    if (nSign > 0) {
      items.push(`<li>Не подписано контрагентами: <strong>${nSign}</strong></li>`);
      itemsEn.push(`<li>Not signed by counterparties: <strong>${nSign}</strong></li>`);
    }
    if (nExp > 0) {
      items.push(`<li>Договоры истекают в ближайшие 30 дней: <strong>${nExp}</strong></li>`);
      itemsEn.push(`<li>Contracts expiring in the next 30 days: <strong>${nExp}</strong></li>`);
    }

    // Строка про лимит — только когда план вообще ограничен.
    try {
      const plan = await planFor(db, u.id);
      const limit = PLAN_LIMITS[plan]?.ai ?? null;
      if (limit !== null) {
        const usage = await monthlyUsage(db, u.id);
        items.push(`<li>ИИ-анализы в этом месяце: <strong>${usage.aiRequests} из ${limit}</strong></li>`);
        itemsEn.push(`<li>AI analyses this month: <strong>${usage.aiRequests} of ${limit}</strong></li>`);
      }
    } catch {
      /* сводка важнее строки про лимит */
    }

    void sendMail({
      to: u.email,
      subject: biSubject('Lexab: ваша сводка недели', 'Lexab: your weekly digest'),
      html: mailLayout(
        biLine('Сводка недели', 'Weekly digest'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(u.name)}</strong>!</p>
         <p>Вот что накопилось к понедельнику:</p>
         <ul>${items.join('')}</ul>
         <p style="color:#8a8f98;font-size:13px">Отключить сводку можно в Настройках → Профиль.</p>`,
          `<p>Hello <strong>${escapeMailHtml(u.name)}</strong>,</p>
         <p>Here is what has piled up by Monday:</p>
         <ul>${itemsEn.join('')}</ul>
         <p style="color:#8a8f98;font-size:13px">You can turn the digest off in Settings → Profile.</p>`,
        ),
        biLine('Открыть Lexab', 'Open Lexab'),
        `${config.appBaseUrl}/chat`,
      ),
    });
    sent += 1;
  }
  return sent;
}
