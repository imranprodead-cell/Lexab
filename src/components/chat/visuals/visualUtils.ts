import { useLayoutEffect, useState, type RefObject } from 'react';
import { localeFor } from '@/i18n/dates';
import { buildIcs, downloadIcs, type CalendarEvent } from '@/lib/renewal';

/** Сегодня по часам пользователя, YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Дней от сегодня до даты (отрицательное — прошло). */
export function daysFrom(today: string, iso: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** «через 9 дней», «3 дня назад», «сегодня», «завтра» — на языке интерфейса. */
export function relDays(days: number, lang: string): string {
  return new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' }).format(days, 'day');
}

/** «25 нояб. 2026 г.» */
export function fmtDate(iso: string, lang: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Короткий устойчивый id события календаря. */
function uidOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Скачать .ics с датами (напоминания за 7 и за 1 день — как в «Контрактах»). */
export function saveToCalendar(title: string, items: { date: string; title: string; description?: string }[]): void {
  const events: CalendarEvent[] = items.map((it) => ({ uid: uidOf(`${title}|${it.date}|${it.title}`), ...it }));
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Lexab';
  downloadIcs(buildIcs(events), `Lexab — ${safe}.ics`);
}

/** Ширина элемента (график перестраивается под колонку чата и панель). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 600): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}
