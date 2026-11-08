/**
 * Действия агента с документом (решение владельца 2026-10-31).
 *
 * Агент только ПРЕДЛАГАЕТ правку пункта договора (инструмент propose_edit);
 * вносит её пользователь кнопкой «Принять» — POST /analysis/:id/redlines.
 * Правка ложится в разбор так же, как правки самого разбора: строка в
 * redlines + слот в документе. Значит, она видна в рабочей области,
 * применяется к «Весь договор» и экспорту, её можно отклонить или вернуть.
 *
 * Правила, которые держит КОД, а не промпт:
 *  - править может только тот, у кого есть права на запись (владелец или
 *    участник команды с правом редактирования);
 *  - цитируемый пункт обязан найтись в тексте договора — по тем же правилам,
 *    по которым к тексту применяются правки (иначе принятая правка молча не
 *    встала бы в договор);
 *  - повторное нажатие не плодит дубли.
 */
import type { Db, Queryable } from '../db.ts';
import { decJsonFromJsonb, decText, encJsonForJsonb, encText } from './docCrypto.ts';
import { badRequest, HttpError } from './errors.ts';
import { blocksToText } from './firmMemory.ts';
import { containsLoose, loadSourceText } from './fullText.ts';
import { canEdit, resolveAnalysisAccess, resolveDocumentAccess } from './teamAccess.ts';
import { newId } from './ids.ts';
import type { DocBlock, Redline, Severity } from '../types.ts';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Разбор, к которому агент может предлагать правки (у пользователя есть права на запись). */
export interface EditTarget {
  analysisId: string;
  ownerId: string;
  /** Текст договора, где должен найтись цитируемый пункт. */
  contractText: string;
}

/** Предложенная агентом правка — уходит в ответ карточкой с кнопкой «Принять». */
export interface EditProposal {
  analysisId: string;
  delText: string;
  insText: string;
  reason: string;
}

interface RedlineRow {
  id: string;
  del_text: string;
  ins_text: string;
  severity: Severity;
  status: 'pending' | 'accepted' | 'rejected';
}

async function decryptedRedlines(db: Queryable, ownerId: string, analysisId: string) {
  const res = await db.query<RedlineRow>('SELECT id, del_text, ins_text, severity, status FROM redlines WHERE analysis_id = $1 ORDER BY ord', [analysisId]);
  const out: { id: string; delText: string; insText: string; severity: Severity; status: RedlineRow['status'] }[] = [];
  for (const r of res.rows) {
    const delText = await decText(db, ownerId, r.del_text);
    const insText = await decText(db, ownerId, r.ins_text);
    if (delText === null || insText === null) continue;
    out.push({ id: r.id, delText, insText, severity: r.severity, status: r.status });
  }
  return out;
}

/** Исходный файл + пункты документа разбора (с их «было» из правок). */
async function contractTextOf(db: Db, ownerId: string, analysisId: string): Promise<string> {
  const row = (
    await db.query<{ file_name: string; upload_id: string | null; document_blocks: unknown }>(
      'SELECT file_name, upload_id, document_blocks FROM analyses WHERE id = $1',
      [analysisId],
    )
  ).rows[0];
  if (!row) return '';
  const source = await loadSourceText(db, ownerId, { fileName: row.file_name, uploadId: row.upload_id, nameFallback: false }).catch(() => ({ text: null }));
  const blocks = blocksToText(await decJsonFromJsonb(db, ownerId, row.document_blocks).catch(() => null));
  const clauses = (await decryptedRedlines(db, ownerId, analysisId)).map((r) => r.delText);
  return [source.text ?? '', blocks, ...clauses].filter(Boolean).join('\n');
}

/** Чистый текст договора разбора (исходный файл; нет — текст пунктов документа) — для сравнения редакций. */
export async function reviewSourceText(db: Db, ownerId: string, analysisId: string): Promise<string> {
  const row = (
    await db.query<{ file_name: string; upload_id: string | null; document_blocks: unknown }>(
      'SELECT file_name, upload_id, document_blocks FROM analyses WHERE id = $1',
      [analysisId],
    )
  ).rows[0];
  if (!row) return '';
  const source = await loadSourceText(db, ownerId, { fileName: row.file_name, uploadId: row.upload_id, nameFallback: false }).catch(() => ({ text: null }));
  return source.text?.trim() ? source.text : blocksToText(await decJsonFromJsonb(db, ownerId, row.document_blocks).catch(() => null));
}

/** Цель правок для агента: разбор, который пользователь может ПРАВИТЬ; иначе null. */
export async function loadEditTarget(db: Db, userId: string, analysisId: string): Promise<EditTarget | null> {
  try {
    const access = await resolveAnalysisAccess(db, userId, analysisId, true);
    return { analysisId, ownerId: access.analysisUserId, contractText: await contractTextOf(db, access.analysisUserId, analysisId) };
  } catch {
    return null;
  }
}

/**
 * Правки и находки разбора — для протокола разногласий и ссылок на «правку №».
 * Доступ на чтение проверяет вызывающий (чат уже открыл этот разбор).
 */
export async function reviewEditsText(db: Db, ownerId: string, analysisId: string): Promise<string> {
  const redlines = await decryptedRedlines(db, ownerId, analysisId);
  const findings = await db.query<{ title: string; citation: string; severity: string; unverified: boolean; redline_id: string | null }>(
    'SELECT title, citation, severity, unverified, redline_id FROM findings WHERE analysis_id = $1 ORDER BY ord',
    [analysisId],
  );
  const byRedline = new Map(findings.rows.filter((f) => f.redline_id).map((f) => [f.redline_id as string, f]));
  const lines: string[] = [];
  for (const r of redlines) {
    const f = byRedline.get(r.id);
    lines.push(
      [
        `[${r.id}] status ${r.status}, severity ${r.severity}`,
        `  contract wording: «${r.delText}»`,
        `  proposed wording: «${r.insText}»`,
        f ? `  reason: ${f.title}${f.citation ? ` (${f.citation}${f.unverified ? ', citation not confirmed' : ''})` : ''}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  const loose = findings.rows.filter((f) => !f.redline_id);
  if (loose.length) {
    lines.push('Findings without a proposed edit:', ...loose.map((f) => `- [${f.severity}] ${f.title}${f.citation ? ` (${f.citation})` : ''}`));
  }
  return lines.length ? lines.join('\n\n') : 'The review has no proposed edits or findings.';
}

/** Проверка предложения агента до показа карточки. Ошибка — текстом для модели. */
export function checkProposal(target: EditTarget, delText: string, insText: string): string | null {
  if (!norm(delText)) return 'clause is empty';
  if (norm(delText) === norm(insText)) return 'new_text is the same as the clause';
  if (!containsLoose(target.contractText, delText)) {
    return 'QUOTE_NOT_FOUND: the clause must be quoted exactly as it stands in the contract (find it with read_contract and copy it word for word)';
  }
  return null;
}

/**
 * Внести правку в разбор (кнопка «Принять» в чате). Повтор с тем же текстом —
 * та же правка (статус обновляется), без дубля.
 */
export async function addEditToAnalysis(
  db: Db,
  userId: string,
  analysisId: string,
  input: { delText: string; insText: string; status: 'accepted' | 'pending'; severity?: Severity },
): Promise<{ redline: Redline; created: boolean; ownerId: string }> {
  const access = await resolveAnalysisAccess(db, userId, analysisId, true);
  const owner = access.analysisUserId;
  const delText = input.delText.trim();
  const insText = input.insText.trim();
  if (!delText) throw badRequest('Field "delText" is required');
  if (norm(delText) === norm(insText)) throw badRequest('Новая редакция совпадает со старой / The new wording is the same as the old one');
  if (!containsLoose(await contractTextOf(db, owner, analysisId), delText)) {
    throw new HttpError(
      422,
      'Этот пункт не найден в тексте договора — правку нельзя внести. / This clause was not found in the contract text.',
      'clause_not_found',
    );
  }

  return db.withTx(async (tx) => {
    const existing = await decryptedRedlines(tx, owner, analysisId);
    const same = existing.find((r) => norm(r.delText) === norm(delText) && norm(r.insText) === norm(insText));
    if (same) {
      if (same.status !== input.status) {
        await tx.query('UPDATE redlines SET status = $3 WHERE analysis_id = $1 AND id = $2', [analysisId, same.id, input.status]);
      }
      return { redline: { id: same.id, delText: same.delText, insText: same.insText, severity: same.severity, status: input.status }, created: false, ownerId: owner };
    }
    const ids = (await tx.query<{ id: string }>('SELECT id FROM redlines WHERE analysis_id = $1', [analysisId])).rows.map((r) => r.id);
    const maxN = ids.reduce((m, id) => Math.max(m, Number(/^r(\d+)$/.exec(id)?.[1] ?? 0)), 0);
    const id = `r${maxN + 1}`;
    const severity: Severity = input.severity ?? 'Medium';
    await tx.query(
      `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [analysisId, id, ids.length, await encText(tx, owner, delText), await encText(tx, owner, insText), severity, input.status],
    );
    // Слот правки — новым пунктом в документе разбора. Если ручные правки уже
    // были, их «исходная редакция» дополняется тем же пунктом: иначе сверка
    // «было → стало» приняла бы новый пункт за ручную вставку («внесите вручную»).
    const row = (await tx.query<{ document_blocks: unknown; original_blocks: unknown }>('SELECT document_blocks, original_blocks FROM analyses WHERE id = $1', [analysisId])).rows[0];
    const blocks = ((await decJsonFromJsonb(tx, owner, row?.document_blocks)) as DocBlock[] | null) ?? [];
    blocks.push({ type: 'paragraph', segments: [{ redlineId: id }] });
    let original: string | null = null;
    if (row?.original_blocks !== null && row?.original_blocks !== undefined) {
      const before = await decJsonFromJsonb(tx, owner, row.original_blocks);
      if (Array.isArray(before)) original = await encJsonForJsonb(tx, owner, [...before, delText]);
    }
    await tx.query('UPDATE analyses SET document_blocks = $2, original_blocks = COALESCE($3, original_blocks) WHERE id = $1', [
      analysisId,
      await encJsonForJsonb(tx, owner, blocks),
      original,
    ]);
    return { redline: { id, delText, insText, severity, status: input.status }, created: true, ownerId: owner };
  });
}

/* ── карточки правок в тексте ответа ───────────────────────────────────── */

/** Служебный блок, из которого интерфейс рисует карточку «Было → Станет». */
export const EDIT_FENCE = 'lexab-edit';

/** Дописать предложенные правки в конец ответа (сохраняется вместе с ним). */
export function appendEditBlocks(reply: string, proposals: EditProposal[]): string {
  if (!proposals.length) return reply;
  // Обратные кавычки — \u0060: «```» внутри текста правки не закроет блок раньше времени.
  const blocks = proposals.map((p) => `\`\`\`${EDIT_FENCE}\n${JSON.stringify(p).replace(/`/g, '\\u0060')}\n\`\`\``);
  return `${reply.trimEnd()}\n\n${blocks.join('\n\n')}`;
}

/* ── сроки и напоминания на почту ───────────────────────────────────────── */

/** Срок, предложенный агентом, — карточка «Добавить напоминание» под ответом. */
export interface ReminderProposal {
  documentId: string;
  documentName: string;
  text: string;
  /** YYYY-MM-DD */
  dueDate: string;
  remindDaysBefore: number;
}

export const REMINDER_FENCE = 'lexab-reminder';

/** YYYY-MM-DD, реальная дата (31.02 — нет). */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Дата напоминания: срок минус N дней (не раньше сегодня). */
export function remindOn(dueDate: string, days: number): string {
  const d = new Date(`${dueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  const iso = d.toISOString().slice(0, 10);
  return iso < todayIso() ? todayIso() : iso;
}

/**
 * Добавить срок к договору (кнопка «Добавить напоминание» в чате). Ложится в
 * «Сроки и обязательства» (contract_obligations, source='chat'): виден на
 * дашборде, отмечается «выполнено», повторный разбор его не стирает. Письмо
 * уходит добавившему за remindDaysBefore дней (checkContractDeadlines).
 * Права — как у отметки «выполнено»: владелец, админ или редактор.
 */
export async function addReminderToDocument(
  db: Db,
  userId: string,
  documentId: string,
  input: { text: string; dueDate: string; remindDaysBefore: number },
): Promise<{ id: string; created: boolean; remindOn: string }> {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text) throw badRequest('Field "text" is required');
  if (text.length > 500) throw badRequest('Текст срока длиннее 500 символов / The deadline text is longer than 500 characters');
  if (!isIsoDate(input.dueDate)) throw badRequest('Дата — в формате ГГГГ-ММ-ДД / The date must be YYYY-MM-DD');
  if (input.dueDate < todayIso()) throw badRequest('Срок уже прошёл / The deadline is in the past');
  const days = input.remindDaysBefore;
  if (!Number.isInteger(days) || days < 0 || days > 60) throw badRequest('Напоминание — за 0–60 дней / Remind 0–60 days before');
  const { doc, access } = await resolveDocumentAccess(db, userId, documentId);
  if (!canEdit(access)) throw new HttpError(403, 'Недостаточно прав: сроки добавляют владелец, админ или редактор / Not allowed');
  const owner = doc.user_id;

  return db.withTx(async (tx) => {
    // Карточка договора в «Сроках» — чтобы срок был виден на дашборде даже у
    // документа, у которого разбор сроков не извлёк.
    await tx.query('INSERT INTO contract_terms (document_id) VALUES ($1) ON CONFLICT (document_id) DO NOTHING', [documentId]);
    const existing = await tx.query<{ id: string; text_enc: string; due_date: string }>(
      "SELECT id, text_enc, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM contract_obligations WHERE document_id = $1 AND source = 'chat'",
      [documentId],
    );
    for (const o of existing.rows) {
      if (o.due_date !== input.dueDate) continue;
      const t = await decText(tx, owner, o.text_enc);
      if (t !== null && norm(t) === text) {
        await tx.query('UPDATE contract_obligations SET remind_days_before = $2 WHERE id = $1', [o.id, days]);
        return { id: o.id, created: false, remindOn: remindOn(input.dueDate, days) };
      }
    }
    const ord = Number((await tx.query<{ n: number | string }>('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM contract_obligations WHERE document_id = $1', [documentId])).rows[0].n);
    const id = newId('ob');
    await tx.query(
      `INSERT INTO contract_obligations (id, document_id, ord, text_enc, due_date, responsible, reminded, done, source, remind_days_before, created_by)
       VALUES ($1, $2, $3, $4, $5, NULL, false, false, 'chat', $6, $7)`,
      [id, documentId, ord, await encText(tx, owner, text), input.dueDate, days, userId],
    );
    return { id, created: true, remindOn: remindOn(input.dueDate, days) };
  });
}

/** Дописать предложенные сроки в конец ответа (как правки — служебными блоками). */
export function appendReminderBlocks(reply: string, reminders: ReminderProposal[]): string {
  if (!reminders.length) return reply;
  const blocks = reminders.map((r) => `\`\`\`${REMINDER_FENCE}\n${JSON.stringify(r).replace(/`/g, '\\u0060')}\n\`\`\``);
  return `${reply.trimEnd()}\n\n${blocks.join('\n\n')}`;
}
