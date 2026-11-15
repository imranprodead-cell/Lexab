import { describe, expect, it } from 'vitest';
import { addDaysIso, buildIcs, calendarDate, foldIcsLine, hasCalendarDate, needsAction, renewalInfo } from './renewal';

const NOW = new Date(2026, 10, 15); // 15 ноября 2026, локальная полночь

describe('renewalInfo', () => {
  it('last day = end minus notice days, counted from today', () => {
    const r = renewalInfo({ expiryDate: '2026-12-21', autoRenew: true, renewalNoticeDays: 30 }, NOW);
    expect(r).toEqual({ kind: 'notice', end: '2026-12-21', last: '2026-11-21', daysToLast: 6, notice: 30 });
    expect(needsAction(r)).toBe(true);
  });

  it('a passed opt-out day is not "act now"', () => {
    const r = renewalInfo({ expiryDate: '2026-11-20', autoRenew: true, renewalNoticeDays: 30 }, NOW);
    expect(r.kind === 'notice' && r.daysToLast).toBe(-25);
    expect(needsAction(r)).toBe(false);
  });

  it('no auto-renewal and missing notice period are reported, never guessed', () => {
    expect(renewalInfo({ expiryDate: '2027-03-31', autoRenew: false, renewalNoticeDays: 30 }, NOW).kind).toBe('noRenew');
    expect(renewalInfo({ expiryDate: '2027-03-31', autoRenew: true, renewalNoticeDays: null }, NOW).kind).toBe('noNotice');
    expect(renewalInfo({ expiryDate: null, autoRenew: true, renewalNoticeDays: 30 }, NOW).kind).toBe('unknown');
  });

  it('calendar gets the opt-out day, else the end date; nothing without dates or in the past', () => {
    expect(calendarDate(renewalInfo({ expiryDate: '2026-12-21', autoRenew: true, renewalNoticeDays: 30 }, NOW))).toEqual({ date: '2026-11-21', kind: 'optout' });
    expect(calendarDate(renewalInfo({ expiryDate: '2027-03-31', autoRenew: false, renewalNoticeDays: null }, NOW))).toEqual({ date: '2027-03-31', kind: 'end' });
    expect(calendarDate(renewalInfo({ expiryDate: '2026-11-01', autoRenew: false, renewalNoticeDays: null }, NOW))).toBeNull();
    expect(hasCalendarDate({ expiryDate: null, autoRenew: null, renewalNoticeDays: null })).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    expect(addDaysIso('2027-01-15', -30)).toBe('2026-12-16');
    expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('buildIcs', () => {
  it('writes an all-day event with two reminders and CRLF line ends', () => {
    const ics = buildIcs([{ uid: 'doc1-optout', date: '2026-11-21', title: 'Отказ, ООО «Навбахор»; срок', description: 'a,b' }], new Date(Date.UTC(2026, 10, 15, 9, 0, 0)));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261121\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261122\r\n');
    expect(ics).toContain('DTSTAMP:20261115T090000Z');
    expect(ics).toContain('SUMMARY:Отказ\\, ООО «Навбахор»\\; срок');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain('TRIGGER:-P7D');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds long lines at 75 bytes without splitting a Cyrillic letter', () => {
    const line = `SUMMARY:${'Ж'.repeat(80)}`;
    const folded = foldIcsLine(line);
    const enc = new TextEncoder();
    for (const part of folded.split('\r\n')) expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });
});
