import { useCallback, useMemo, useState } from 'react';
import { decisionsApi } from '@/api/decisions.api';
import type { ContractRow, ContractTermsInfo } from '@/types/domain';

/**
 * «Последний день отказа» по извлечённым условиям договора: окончание минус
 * срок уведомления о непродлении. Дата берётся только из самого договора
 * (terms), ничего не придумывается: нет срока уведомления — так и говорим.
 */
export type RenewalInfo =
  | { kind: 'unknown' }
  | { kind: 'noRenew'; end: string; daysToEnd: number | null }
  | { kind: 'noNotice'; end: string }
  | { kind: 'notice'; end: string; last: string; daysToLast: number; notice: number };

const DAY = 86_400_000;

/** 'YYYY-MM-DD' (или полная ISO-строка) → полночь UTC этого дня. */
export function isoDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(isoDay(iso) + days * DAY).toISOString().slice(0, 10);
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function renewalInfo(terms: Pick<ContractTermsInfo, 'expiryDate' | 'autoRenew' | 'renewalNoticeDays'>, now = new Date()): RenewalInfo {
  const end = terms.expiryDate;
  if (!end) return { kind: 'unknown' };
  const daysToEnd = Math.round((isoDay(end) - todayUtc(now)) / DAY);
  if (terms.autoRenew !== true) return { kind: 'noRenew', end, daysToEnd };
  if (terms.renewalNoticeDays == null || terms.renewalNoticeDays < 0) return { kind: 'noNotice', end };
  const last = addDaysIso(end, -terms.renewalNoticeDays);
  const daysToLast = Math.round((isoDay(last) - todayUtc(now)) / DAY);
  return { kind: 'notice', end, last, daysToLast, notice: terms.renewalNoticeDays };
}

/** Надо ли действовать в ближайшие `within` дней (и срок ещё не прошёл). */
export const needsAction = (info: RenewalInfo, within = 30): boolean =>
  info.kind === 'notice' && info.daysToLast >= 0 && info.daysToLast <= within;

/** Какую дату ставить в календарь: последний день отказа, иначе окончание; прошедшие — нет. */
export function calendarDate(info: RenewalInfo): { date: string; kind: 'optout' | 'end' } | null {
  if (info.kind === 'notice' && info.daysToLast >= 0) return { date: info.last, kind: 'optout' };
  if (info.kind === 'noNotice') return { date: info.end, kind: 'end' };
  if (info.kind === 'noRenew' && (info.daysToEnd ?? 0) >= 0) return { date: info.end, kind: 'end' };
  return null;
}

export const hasCalendarDate = (terms: Pick<ContractTermsInfo, 'expiryDate' | 'autoRenew' | 'renewalNoticeDays'>): boolean =>
  calendarDate(renewalInfo(terms)) !== null;

/* ---------------------------- iCalendar (.ics) ---------------------------- */

export interface CalendarEvent {
  uid: string;
  /** 'YYYY-MM-DD' — событие на весь день. */
  date: string;
  title: string;
  description?: string;
}

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545: строки не длиннее 75 байт, перенос — CRLF + пробел (по байтам UTF-8). */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + b > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(events: CalendarEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lexab//Contract dates//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@lexab`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDaysIso(e.date, 1))}`,
      `SUMMARY:${icsEscape(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    for (const trigger of ['-P7D', '-P1D']) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.title)}`, `TRIGGER:${trigger}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function downloadIcs(ics: string, fileName: string): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.ics') ? fileName : `${fileName}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------- отметки по продлению -------------------------- */

export interface RenewalMark {
  kind: 'sent' | 'keep';
  who: string;
  at: string;
  /** Для какой даты отказа поставлена отметка: новая редакция — новый срок. */
  last: string;
}

/**
 * Отметки «Отказ отправлен» / «Продлеваем»: приходят с сервера в строках
 * реестра (renewalMark), меняются сразу на экране и сохраняются на сервере —
 * их видит команда. Ошибка сервера возвращает прежнюю отметку и пробрасывается.
 */
export function useRenewalMarks(rows: ContractRow[]) {
  const [over, setOver] = useState<Record<string, RenewalMark | null>>({});
  const map = useMemo(() => {
    const m: Record<string, RenewalMark> = {};
    for (const r of rows) {
      const v = r.documentId in over ? over[r.documentId] : (r.renewalMark ?? null);
      if (v) m[r.documentId] = v;
    }
    return m;
  }, [rows, over]);

  const set = useCallback(
    async (documentId: string, mark: RenewalMark | null): Promise<void> => {
      const before = map[documentId] ?? null;
      setOver((o) => ({ ...o, [documentId]: mark }));
      try {
        if (mark) {
          const saved = await decisionsApi.setRenewalMark(documentId, mark.kind, mark.last);
          setOver((o) => ({ ...o, [documentId]: saved }));
        } else {
          await decisionsApi.clearRenewalMark(documentId);
        }
      } catch (err) {
        setOver((o) => ({ ...o, [documentId]: before }));
        throw err;
      }
    },
    [map],
  );

  return { map, set };
}

/** Черновик для нового чата: ChatInput читает его при открытии (ключ 'chat'). */
export function prefillChatDraft(text: string): void {
  try {
    const all = JSON.parse(localStorage.getItem('lexai.drafts') ?? '{}') as Record<string, string>;
    all.chat = text;
    localStorage.setItem('lexai.drafts', JSON.stringify(all));
  } catch {
    /* storage blocked — the user just types the request */
  }
}
