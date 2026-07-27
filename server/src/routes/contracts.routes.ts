/**
 * CLM (Этап 2) — жизненный цикл договоров: сроки, автопродления, обязательства.
 *
 * Данные извлекает анализ (persistAnalysis пишет contract_terms /
 * contract_obligations); здесь — дашборд GET /contracts, карточка одного
 * документа GET /contracts/:documentId, отметка «выполнено» на обязательстве
 * и фоновая проверка дедлайнов checkContractDeadlines() (интервал в index.ts).
 *
 * Гейт: фича 'clm' (Pro+). Извлечение работает на всех планах (данные копятся),
 * но дашборд и напоминания — только для планов с фичей.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { decText } from '../lib/docCrypto.ts';
import { assertFeature, planFor, planHasFeature } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { canEdit, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { asObject } from '../lib/validate.ts';
import { biBody, biLine, biSubject, escapeMailHtml, mailLayout, sendMail } from '../mail.ts';

interface ContractTermsWire {
  effectiveDate: string | null;
  expiryDate: string | null;
  /** Дней до окончания (по CURRENT_DATE сервера); null без даты окончания. */
  daysToExpiry: number | null;
  autoRenew: boolean | null;
  renewalNoticeDays: number | null;
  contractValue: string | null;
  currency: string | null;
  governingLaw: string | null;
  extractedAt: string;
}

interface ObligationWire {
  id: string;
  text: string;
  dueDate: string | null;
  responsible: string | null;
  done: boolean;
}

interface ContractWire {
  documentId: string;
  name: string;
  counterparty: string;
  risk: string;
  status: string;
  mine: boolean;
  terms: ContractTermsWire;
  obligations: ObligationWire[];
}

interface TermsRow {
  document_id: string;
  name: string;
  counterparty: string;
  risk: string;
  status: string;
  owner_id: string;
  effective_date: string | null;
  expiry_date: string | null;
  days_to_expiry: number | string | null;
  auto_renew: boolean | null;
  renewal_notice_days: number | null;
  contract_value_enc: string | null;
  currency: string | null;
  governing_law: string | null;
  extracted_at: Date | string;
}

interface ObligationRow {
  id: string;
  document_id: string;
  text_enc: string;
  due_date: string | null;
  responsible: string | null;
  done: boolean;
}

// DATE-колонки всегда отдаём из SQL строкой to_char(...,'YYYY-MM-DD'):
// драйвер pg парсит DATE в локальную полночь, и toISOString() в поясе UTC+
// сдвигал бы дату на день назад.
const TERMS_SELECT = `
  SELECT d.id AS document_id, d.name, d.counterparty, d.risk, d.status, d.user_id AS owner_id,
         to_char(t.effective_date, 'YYYY-MM-DD') AS effective_date,
         to_char(t.expiry_date, 'YYYY-MM-DD') AS expiry_date,
         (t.expiry_date - CURRENT_DATE) AS days_to_expiry,
         t.auto_renew, t.renewal_notice_days, t.contract_value_enc, t.currency, t.governing_law, t.extracted_at
  FROM contract_terms t
  JOIN documents d ON d.id = t.document_id AND d.deleted_at IS NULL`;

async function toWire(db: Db, row: TermsRow, viewerId: string, obligations: ObligationRow[]): Promise<ContractWire> {
  const value = row.contract_value_enc ? await decText(db, row.owner_id, row.contract_value_enc) : null;
  const obs: ObligationWire[] = [];
  for (const o of obligations) {
    const text = await decText(db, row.owner_id, o.text_enc);
    if (text === null) continue;
    obs.push({ id: o.id, text, dueDate: o.due_date, responsible: o.responsible, done: o.done });
  }
  return {
    documentId: row.document_id,
    name: row.name,
    counterparty: row.counterparty,
    risk: row.risk,
    status: row.status,
    mine: row.owner_id === viewerId,
    terms: {
      effectiveDate: row.effective_date,
      expiryDate: row.expiry_date,
      daysToExpiry: row.days_to_expiry === null ? null : Number(row.days_to_expiry),
      autoRenew: row.auto_renew,
      renewalNoticeDays: row.renewal_notice_days,
      contractValue: value,
      currency: row.currency,
      governingLaw: row.governing_law,
      extractedAt: new Date(row.extracted_at as string).toISOString(),
    },
    obligations: obs,
  };
}

export function contractRoutes(app: FastifyInstance, db: Db): void {
  // Дашборд: свои документы + расшаренные командой (как GET /documents).
  app.get('/contracts', { preHandler: [app.authenticate] }, async (req): Promise<ContractWire[]> => {
    await assertFeature(db, req.currentUser.id, 'clm');
    const rows = await db.query<TermsRow>(
      `${TERMS_SELECT}
       WHERE d.user_id = $1
          OR (d.team_shared AND d.user_id IN (
                SELECT owner_user_id FROM team_members
                WHERE member_user_id = $1 AND status = 'active'))
       ORDER BY t.expiry_date ASC NULLS LAST, d.updated_at DESC
       LIMIT 500`,
      [req.currentUser.id],
    );
    if (!rows.rows.length) return [];
    const ids = rows.rows.map((r) => r.document_id);
    const obligations = await db.query<ObligationRow>(
      `SELECT id, document_id, text_enc, to_char(due_date, 'YYYY-MM-DD') AS due_date, responsible, done
       FROM contract_obligations WHERE document_id = ANY($1::text[]) ORDER BY ord`,
      [ids],
    );
    const byDoc = new Map<string, ObligationRow[]>();
    for (const o of obligations.rows) {
      const list = byDoc.get(o.document_id) ?? [];
      list.push(o);
      byDoc.set(o.document_id, list);
    }
    const out: ContractWire[] = [];
    for (const row of rows.rows) {
      out.push(await toWire(db, row, req.currentUser.id, byDoc.get(row.document_id) ?? []));
    }
    return out;
  });

  // Карточка сроков одного документа (для страницы документа).
  app.get('/contracts/:documentId', { preHandler: [app.authenticate] }, async (req): Promise<ContractWire> => {
    await assertFeature(db, req.currentUser.id, 'clm');
    const { documentId } = req.params as { documentId: string };
    await resolveDocumentAccess(db, req.currentUser.id, documentId); // owner или активный член команды — иначе 404
    const rows = await db.query<TermsRow>(`${TERMS_SELECT} WHERE t.document_id = $1`, [documentId]);
    if (!rows.rows[0]) throw notFound('Для этого документа нет извлечённых сроков');
    const obligations = await db.query<ObligationRow>(
      `SELECT id, document_id, text_enc, to_char(due_date, 'YYYY-MM-DD') AS due_date, responsible, done
       FROM contract_obligations WHERE document_id = $1 ORDER BY ord`,
      [documentId],
    );
    return toWire(db, rows.rows[0], req.currentUser.id, obligations.rows);
  });

  // Отметка «выполнено» на обязательстве. Право — владелец/admin/editor.
  app.patch(
    '/contracts/:documentId/obligations/:obligationId',
    { preHandler: [app.authenticateReal] },
    async (req): Promise<{ id: string; done: boolean }> => {
      await assertFeature(db, req.currentUser.id, 'clm');
      const { documentId, obligationId } = req.params as { documentId: string; obligationId: string };
      const body = asObject(req.body);
      if (typeof body.done !== 'boolean') throw badRequest('Поле "done" — булево');
      const { access } = await resolveDocumentAccess(db, req.currentUser.id, documentId);
      if (!canEdit(access)) throw badRequest('Недостаточно прав: отметки ставят владелец, админ или редактор');
      const res = await db.query<{ id: string }>(
        'UPDATE contract_obligations SET done = $3 WHERE id = $1 AND document_id = $2 RETURNING id',
        [obligationId, documentId, body.done],
      );
      if (!res.rows[0]) throw notFound('Обязательство не найдено');
      return { id: obligationId, done: body.done };
    },
  );
}

/** ДД.ММ.ГГГГ из ISO-строки — без Date, чтобы не ловить сдвиг часового пояса. */
function ruDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Ежедневная проверка дедлайнов CLM (интервал в index.ts). Идемпотентна через
 * флаги *_reminded (leader-election нет — флаг обязателен). Три прохода:
 * окончание срока (≤30 дней), дедлайн уведомления о непродлении (≤14 дней),
 * обязательства с датой (≤7 дней). Просроченные при первом проходе даты
 * (историческая загрузка) помечаются молча — без спама задним числом.
 * Напоминания получают только владельцы с фичей 'clm' (Pro+).
 */
export async function checkContractDeadlines(db: Db): Promise<void> {
  const planCache = new Map<string, string>();
  const ownerHasClm = async (userId: string): Promise<boolean> => {
    let plan = planCache.get(userId);
    if (!plan) {
      plan = await planFor(db, userId);
      planCache.set(userId, plan);
    }
    return planHasFeature(plan, 'clm');
  };

  // 1) Срок договора подходит к концу (≤30 дней).
  const expiring = await db.query<{
    document_id: string;
    expiry_date: string;
    days_left: number | string;
    name: string;
    owner_id: string;
    owner_name: string;
    owner_email: string;
  }>(
    `SELECT t.document_id, to_char(t.expiry_date, 'YYYY-MM-DD') AS expiry_date,
            (t.expiry_date - CURRENT_DATE) AS days_left,
            d.name, u.id AS owner_id, u.name AS owner_name, u.email AS owner_email
     FROM contract_terms t
     JOIN documents d ON d.id = t.document_id AND d.deleted_at IS NULL
     JOIN users u ON u.id = d.user_id
     WHERE t.expiry_reminded = false AND t.expiry_date IS NOT NULL
       AND t.expiry_date <= CURRENT_DATE + 30`,
  );
  for (const row of expiring.rows) {
    const daysLeft = Number(row.days_left);
    if (daysLeft < 0) {
      // истёк до внедрения/загрузки — пометить молча, без спама задним числом
      await db.query('UPDATE contract_terms SET expiry_reminded = true WHERE document_id = $1', [row.document_id]);
      continue;
    }
    // План без CLM: флаг НЕ ставим — после апгрейда напоминание ещё придёт,
    // пока дата в окне. Пометка — только вместе с реальной отправкой.
    if (!(await ownerHasClm(row.owner_id))) continue;
    await db.query('UPDATE contract_terms SET expiry_reminded = true WHERE document_id = $1', [row.document_id]);
    const when = ruDate(row.expiry_date);
    await notify(db, row.owner_id, 'alert', 'Срок договора истекает', 'Contract expiring soon', {
      bodyRu: `${row.name} · до ${when} (осталось дн.: ${daysLeft})`,
      bodyEn: `${row.name} · until ${when} (${daysLeft} days left)`,
      action: { kind: 'open', data: '/contracts' },
    });
    void sendMail({
      to: row.owner_email,
      subject: biSubject(`Срок договора истекает ${when}`, `Contract expires on ${when}`, row.name),
      html: mailLayout(
        biLine('Срок договора подходит к концу', 'The contract term is ending'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(row.owner_name)}</strong>!</p>
         <p>Договор <strong>${escapeMailHtml(row.name)}</strong> действует до <strong>${when}</strong> — осталось ${daysLeft} дн. Проверьте, нужно ли продление или перезаключение.</p>`,
          `<p>Hello <strong>${escapeMailHtml(row.owner_name)}</strong>,</p>
         <p>The contract <strong>${escapeMailHtml(row.name)}</strong> is in force until <strong>${when}</strong> — ${daysLeft} day(s) left. Check whether it needs to be renewed or renegotiated.</p>`,
        ),
        biLine('Открыть контракты', 'Open contracts'),
        `${config.appBaseUrl}/contracts`,
      ),
    });
  }

  // 2) Автопродление: дедлайн уведомления о непродлении (≤14 дней до него).
  const renewals = await db.query<{
    document_id: string;
    notice_deadline: string;
    days_left: number | string;
    name: string;
    owner_id: string;
    owner_name: string;
    owner_email: string;
  }>(
    `SELECT t.document_id,
            to_char(t.expiry_date - t.renewal_notice_days, 'YYYY-MM-DD') AS notice_deadline,
            (t.expiry_date - t.renewal_notice_days - CURRENT_DATE) AS days_left,
            d.name, u.id AS owner_id, u.name AS owner_name, u.email AS owner_email
     FROM contract_terms t
     JOIN documents d ON d.id = t.document_id AND d.deleted_at IS NULL
     JOIN users u ON u.id = d.user_id
     WHERE t.renewal_reminded = false AND t.auto_renew = true
       AND t.renewal_notice_days IS NOT NULL AND t.expiry_date IS NOT NULL
       AND (t.expiry_date - t.renewal_notice_days) <= CURRENT_DATE + 14`,
  );
  for (const row of renewals.rows) {
    const daysLeft = Number(row.days_left);
    if (daysLeft < 0) {
      await db.query('UPDATE contract_terms SET renewal_reminded = true WHERE document_id = $1', [row.document_id]);
      continue;
    }
    if (!(await ownerHasClm(row.owner_id))) continue; // без CLM — не помечаем (см. проход 1)
    await db.query('UPDATE contract_terms SET renewal_reminded = true WHERE document_id = $1', [row.document_id]);
    const when = ruDate(row.notice_deadline);
    await notify(db, row.owner_id, 'alert', 'Автопродление: срок уведомления', 'Auto-renewal notice deadline', {
      bodyRu: `${row.name} · уведомить о непродлении до ${when}`,
      bodyEn: `${row.name} · give non-renewal notice by ${when}`,
      action: { kind: 'open', data: '/contracts' },
    });
    void sendMail({
      to: row.owner_email,
      subject: biSubject(`Автопродление договора — уведомить до ${when}`, `Contract auto-renewal — give notice by ${when}`, row.name),
      html: mailLayout(
        biLine('Приближается срок уведомления о непродлении', 'The non-renewal notice deadline is approaching'),
        biBody(
          `<p>Здравствуйте, <strong>${escapeMailHtml(row.owner_name)}</strong>!</p>
         <p>Договор <strong>${escapeMailHtml(row.name)}</strong> продлевается автоматически. Если продление не нужно, направьте уведомление до <strong>${when}</strong> (осталось ${daysLeft} дн.).</p>`,
          `<p>Hello <strong>${escapeMailHtml(row.owner_name)}</strong>,</p>
         <p>The contract <strong>${escapeMailHtml(row.name)}</strong> renews automatically. If you do not want it renewed, send the non-renewal notice by <strong>${when}</strong> (${daysLeft} day(s) left).</p>`,
        ),
        biLine('Открыть контракты', 'Open contracts'),
        `${config.appBaseUrl}/contracts`,
      ),
    });
  }

  // 3) Обязательства с датой исполнения (≤7 дней).
  const obligations = await db.query<{
    id: string;
    document_id: string;
    text_enc: string;
    due_date: string;
    days_left: number | string;
    name: string;
    owner_id: string;
  }>(
    `SELECT o.id, o.document_id, o.text_enc, to_char(o.due_date, 'YYYY-MM-DD') AS due_date,
            (o.due_date - CURRENT_DATE) AS days_left, d.name, d.user_id AS owner_id
     FROM contract_obligations o
     JOIN documents d ON d.id = o.document_id AND d.deleted_at IS NULL
     WHERE o.reminded = false AND o.done = false AND o.due_date IS NOT NULL
       AND o.due_date <= CURRENT_DATE + 7`,
  );
  for (const row of obligations.rows) {
    const daysLeft = Number(row.days_left);
    if (daysLeft < 0) {
      await db.query('UPDATE contract_obligations SET reminded = true WHERE id = $1', [row.id]);
      continue;
    }
    if (!(await ownerHasClm(row.owner_id))) continue; // без CLM — не помечаем (см. проход 1)
    await db.query('UPDATE contract_obligations SET reminded = true WHERE id = $1', [row.id]);
    const text = (await decText(db, row.owner_id, row.text_enc)) ?? '';
    const short = text.length > 90 ? `${text.slice(0, 90)}…` : text;
    const when = ruDate(row.due_date);
    await notify(db, row.owner_id, 'docs', 'Срок обязательства близко', 'Obligation due soon', {
      bodyRu: `${row.name} · ${short} · до ${when}`,
      bodyEn: `${row.name} · ${short} · due ${when}`,
      action: { kind: 'open', data: '/contracts' },
    });
  }
}
