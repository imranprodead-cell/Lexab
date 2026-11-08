import type { Finding } from '@/types/domain';

/**
 * Нормы, на которые опирается разбор договора, — одним пронумерованным списком.
 * Номер видят в ответе («Основание: ст. 706 ГК [1]»), сам список живёт в правой
 * колонке Sources (решение владельца 2026-10-31: законы — не в тексте ответа).
 */
export interface AnalysisSource {
  n: number;
  key: string;
  citation: string;
  unitId: string | null;
  /** verified — норма найдена в базе законов; unverified — не подтвердилась;
   *  none — разбор сделан до появления проверки ссылок. */
  state: 'verified' | 'unverified' | 'none';
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
export const citationKey = (citation: string) => squash(citation).toLowerCase();

/** По порядку первого упоминания; одна норма — один номер. Если хоть одна
 *  находка подтвердила норму по базе — норма считается проверенной. */
export function analysisSources(findings: Finding[]): AnalysisSource[] {
  const list: AnalysisSource[] = [];
  const at = new Map<string, number>();
  for (const f of findings) {
    const citation = squash(f.citation ?? '');
    if (!citation) continue;
    const key = citationKey(citation);
    const verified = Boolean(f.unitId) && !f.unverified;
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, list.length);
      list.push({
        n: list.length + 1,
        key,
        citation,
        unitId: verified ? (f.unitId as string) : null,
        state: verified ? 'verified' : f.unverified ? 'unverified' : 'none',
      });
    } else if (verified && list[i].state !== 'verified') {
      list[i] = { ...list[i], unitId: f.unitId as string, state: 'verified' };
    }
  }
  return list;
}

/** Событие «покажи источник №n» — его ловит правая колонка (TaskSidebar). */
export const SOURCE_FOCUS_EVENT = 'lexab:focus-source';

/**
 * Открыть источник №n в правой колонке. Возвращает false, если колонки на
 * экране нет (узкое окно или открыт документ) — тогда ответ показывает норму
 * сам, прямо под находкой.
 */
export function focusSource(n: number): boolean {
  const event = new CustomEvent<number>(SOURCE_FOCUS_EVENT, { detail: n, cancelable: true });
  return !window.dispatchEvent(event);
}
