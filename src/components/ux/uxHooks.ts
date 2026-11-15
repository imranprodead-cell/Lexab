import { localeFor } from '@/i18n/dates';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT, type UxT } from '@/i18n/uxMessages';
import { buildIcs, calendarDate, downloadIcs, renewalInfo, type CalendarEvent, type RenewalInfo, type RenewalMark } from '@/lib/renewal';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import type { ContractRow } from '@/types/domain';

/** «15 ноября 2026» — дата решения/отметки (ISO с временем). */
export function useDateLabel() {
  const { lang } = useI18n();
  return (iso: string) => new Date(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Дата договора 'YYYY-MM-DD' без сдвига часового пояса (полдень местного времени). */
const atNoon = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

export function useShortDate() {
  const { lang } = useI18n();
  return (iso: string) => atNoon(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function useLongDate() {
  const { lang } = useI18n();
  return (iso: string) => atNoon(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Имя для подписи под решением: из профиля, иначе «Вы». */
export function useMyName(): string {
  const u = useUxT();
  const name = useAuthStore((s) => s.user?.name);
  return name?.trim() || u('dec.you');
}

/** Отметка актуальна, только если поставлена для той же даты отказа. */
export const activeMark = (info: RenewalInfo, mark?: RenewalMark | null): RenewalMark | null =>
  mark && info.kind === 'notice' && mark.last === info.last ? mark : null;

/** События календаря по строкам реестра: последний день отказа или окончание. */
export function calendarEvents(rows: ContractRow[], u: UxT, long: (iso: string) => string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const r of rows) {
    const info = renewalInfo(r.terms);
    const when = calendarDate(info);
    if (!when || info.kind === 'unknown') continue;
    const description = u('rn.icsDesc', { name: r.name, party: r.counterparty || '—', end: long(info.end) });
    out.push({
      uid: `${r.documentId}-${when.kind}-${when.date}`,
      date: when.date,
      title: u(when.kind === 'optout' ? 'rn.icsTitle' : 'rn.icsEnd', { name: r.name }),
      description,
    });
  }
  return out;
}

/** Скачать .ics по строкам; пусто — честно говорим, что добавлять нечего. */
export function useCalendarDownload() {
  const u = useUxT();
  const long = useLongDate();
  const pushToast = useUIStore((s) => s.pushToast);
  return (rows: ContractRow[], fileName: string) => {
    const events = calendarEvents(rows, u, long);
    if (!events.length) {
      pushToast(u('rn.icsNone'), 'default');
      return;
    }
    downloadIcs(buildIcs(events), fileName);
    pushToast(u('rn.icsDone'), 'default');
  };
}
