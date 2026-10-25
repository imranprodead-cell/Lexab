import type { ChatMessage } from '@/types/domain';
import { extractQuestions, isApproveCommand, looksLikePlan } from './questions';

/** Название шага: жирное действие («**Направьте претензию** …») или начало
 *  пункта до тире / двоеточия. */
function stepTitle(item: string): string {
  const bold = /\*\*(.+?)\*\*/.exec(item)?.[1];
  const title = (bold ?? item.split(/\s[—–-]\s|:\s/)[0]).replace(/[*_`]/g, '').trim();
  return title.length > 90 ? `${title.slice(0, 89).trimEnd()}…` : title;
}

/**
 * Шаги плана — первый нумерованный список ответа /plan (раздел «План
 * действий»: 4–8 пунктов, действие жирным). Список кончается на следующем
 * заголовке; вложенные строки и пустые строки внутри него не мешают.
 */
export function planSteps(text: string): string[] {
  const steps: string[] = [];
  for (const line of text.split('\n')) {
    const item = /^\s{0,3}\d{1,2}[.)]\s+(.+)$/.exec(line);
    if (item) {
      const title = stepTitle(item[1]);
      if (title) steps.push(title);
      continue;
    }
    if (steps.length && /^\s{0,3}#{1,6}\s/.test(line)) break;
  }
  return steps.slice(0, 12);
}

/** Одобренный план чата: ответ-план перед последним «/approve» и его шаги. */
export function approvedPlan(messages: ChatMessage[]): { messageId: string; steps: string[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !isApproveCommand(m.text)) continue;
    for (let j = i - 1; j >= 0; j--) {
      const a = messages[j];
      if (a.role === 'assistant' && a.kind === 'text' && a.text && looksLikePlan(a.text)) {
        const steps = planSteps(extractQuestions(a.text).body);
        return steps.length ? { messageId: a.id, steps } : null;
      }
    }
    return null;
  }
  return null;
}
