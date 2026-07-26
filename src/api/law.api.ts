/** Официальный текст нормы по unit_id — раскрывается под ссылкой в находке. */
import { USE_MOCK, http } from './client';

export interface LawUnit {
  text: string;
  breadcrumb: string;
  actTitle: string;
  jurisdiction: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
}

/** Тексты норм неизменны в рамках сессии — второй клик не ходит в сеть. */
const cache = new Map<string, LawUnit>();

export const lawApi = {
  async unit(unitId: string, signal?: AbortSignal): Promise<LawUnit> {
    const hit = cache.get(unitId);
    if (hit) return hit;
    if (USE_MOCK) {
      const mock: LawUnit = {
        text: 'Условие, ограничивающее ответственность за нарушение договора, ничтожно, если нарушение совершено умышленно.',
        breadcrumb: 'ГК РУз → Часть первая → Статья 333',
        actTitle: 'Гражданский кодекс Республики Узбекистан',
        jurisdiction: 'UZ',
        sourceUrl: 'https://lex.uz/docs/-111181',
        retrievedAt: new Date().toISOString(),
      };
      cache.set(unitId, mock);
      return mock;
    }
    const unit = await http<LawUnit>(`/law/units/${encodeURIComponent(unitId)}`, { signal });
    cache.set(unitId, unit);
    return unit;
  },
};
