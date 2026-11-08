/**
 * Действия, предложенные агентом в чате (server/src/lib/chatActions.ts): правки
 * пунктов (```lexab-edit) и сроки с напоминанием (```lexab-reminder). Сервер
 * дописывает их в конец ответа служебными блоками, например
 *
 *   ```lexab-edit
 *   {"analysisId":"…","delText":"…","insText":"…","reason":"…"}
 *   ```
 *
 * Здесь блоки вырезаются из текста (пользователь не видит разметку) и
 * разбираются для карточек «Было → Станет» с кнопкой «Принять».
 */

export interface EditProposal {
  analysisId: string;
  delText: string;
  insText: string;
  reason: string;
}

/** Срок по договору с напоминанием на почту (кнопка «Добавить напоминание»). */
export interface ReminderProposal {
  documentId: string;
  documentName: string;
  text: string;
  /** YYYY-MM-DD */
  dueDate: string;
  remindDaysBefore: number;
}

const BLOCK = /```lexab-edit[^\n]*\n([\s\S]*?)(?:```|$)/g;
const REMINDER_BLOCK = /```lexab-reminder[^\n]*\n([\s\S]*?)(?:```|$)/g;

function parseReminder(raw: string): ReminderProposal | null {
  try {
    const v = JSON.parse(raw.trim()) as Record<string, unknown>;
    if (typeof v.documentId !== 'string' || typeof v.text !== 'string' || typeof v.dueDate !== 'string') return null;
    if (!v.documentId || !v.text.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)) return null;
    const days = typeof v.remindDaysBefore === 'number' && Number.isInteger(v.remindDaysBefore) ? v.remindDaysBefore : 3;
    return { documentId: v.documentId, documentName: typeof v.documentName === 'string' ? v.documentName : '', text: v.text, dueDate: v.dueDate, remindDaysBefore: days };
  } catch {
    return null;
  }
}

function parse(raw: string): EditProposal | null {
  try {
    const v = JSON.parse(raw.trim()) as Record<string, unknown>;
    if (typeof v.analysisId !== 'string' || typeof v.delText !== 'string' || typeof v.insText !== 'string') return null;
    if (!v.analysisId || !v.delText.trim()) return null;
    return { analysisId: v.analysisId, delText: v.delText, insText: v.insText, reason: typeof v.reason === 'string' ? v.reason : '' };
  } catch {
    return null;
  }
}

/** Текст без служебных блоков + разобранные правки. */
export function extractEdits(text: string): { body: string; edits: EditProposal[] } {
  const edits: EditProposal[] = [];
  const body = text.replace(BLOCK, (_, inner: string) => {
    const p = parse(inner);
    if (p) edits.push(p);
    return '';
  });
  return { body: edits.length || body !== text ? body.trimEnd() : text, edits };
}

/** Все действия агента из ответа: правки и сроки, текст — без служебных блоков. */
export function extractActions(text: string): { body: string; edits: EditProposal[]; reminders: ReminderProposal[] } {
  const { body: withoutEdits, edits } = extractEdits(text);
  const reminders: ReminderProposal[] = [];
  const body = withoutEdits.replace(REMINDER_BLOCK, (_, inner: string) => {
    const r = parseReminder(inner);
    if (r) reminders.push(r);
    return '';
  });
  return { body: body === withoutEdits ? withoutEdits : body.trimEnd(), edits, reminders };
}

/** Только текст — для показа, копирования и поиска документов в ответе. */
export const stripEditBlocks = (text: string): string => extractActions(text).body;
