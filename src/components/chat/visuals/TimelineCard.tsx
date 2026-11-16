import { Fragment } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import { visualAsText, type TimelineVisual } from '@/lib/visuals';
import { CopyButton } from './CopyButton';
import { daysFrom, fmtDate, relDays, saveToCalendar, todayIso } from './visualUtils';
import styles from './visuals.module.css';

/**
 * Шкала сроков. Сверху — линия, где события стоят по своим датам (видно, что
 * близко, а что далеко) и отмечено «сегодня»; ниже — список: дата, событие,
 * «через N дней». Ближайшее будущее событие выделено, прошедшие — бледнее.
 * Даты посчитал сервер (кодом), здесь только показ.
 */
export function TimelineCard({ data }: { data: TimelineVisual }) {
  const u = useUxT();
  const { lang } = useI18n();
  const title = data.title || u('vis.timeline');
  const today = todayIso();
  const events = data.events;
  const nextIdx = events.findIndex((e) => e.date >= today);
  const future = events.filter((e) => e.date >= today);

  const first = events[0].date < today ? events[0].date : today;
  const last = events[events.length - 1].date > today ? events[events.length - 1].date : today;
  const span = daysFrom(first, last);
  const prop = (iso: string) => (span > 0 ? (daysFrom(first, iso) / span) * 100 : 50);
  // По датам — если точки не слипаются; иначе (одна дата далеко, напр.
  // исковая давность через три года) — равномерно по порядку, а «сегодня»
  // между соседями. Точные дни — в списке ниже.
  const propPos = events.map((e) => prop(e.date));
  const crowded = propPos.some((p, i) => i > 0 && p - propPos[i - 1] < 6 && events[i].date !== events[i - 1].date);
  const rankPos = events.map((_, i) => (events.length > 1 ? (i / (events.length - 1)) * 100 : 50));
  const pos = (iso: string): number => {
    if (!crowded) return prop(iso);
    const j = events.findIndex((e) => e.date >= iso);
    if (j < 0) return 100;
    if (events[j].date === iso || j === 0) return rankPos[j];
    const a = events[j - 1].date;
    const b = events[j].date;
    return rankPos[j - 1] + ((rankPos[j] - rankPos[j - 1]) * daysFrom(a, iso)) / Math.max(1, daysFrom(a, b));
  };
  const todayPos = pos(today);
  // Подписи краёв не налезают на «Сегодня».
  const showStart = todayPos > 14;
  const showEnd = todayPos < 86;
  // «Сегодня» — разделителем перед первым будущим событием, если есть и прошлое.
  const todayBefore = nextIdx > 0 ? nextIdx : -1;

  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="calendar" size={16} />
        </span>
        <h4 className={styles.title} dir="auto">
          {title}
        </h4>
        <div className={styles.actions}>
          {future.length ? (
            <button
              type="button"
              className={styles.btn}
              title={u('vis.toCalendar')}
              onClick={() => saveToCalendar(title, future.map((e) => ({ date: e.date, title: e.label, description: e.note })))}
            >
              <Icon name="calendar" size={14} />
              <span className={styles.btnText}>{u('vis.toCalendar')}</span>
            </button>
          ) : null}
          <CopyButton text={() => visualAsText({ kind: 'timeline', data })} />
        </div>
      </div>

      <div className={styles.axis} aria-hidden="true">
        <span className={styles.axisLine} />
        <span className={styles.axisPast} style={{ width: `${todayPos}%` }} />
        {events.map((e, i) => (
          <span
            key={i}
            className={`${styles.axisMark} ${i === nextIdx ? styles.axisMarkNext : e.date < today ? styles.axisMarkPast : ''}`}
            style={{ left: `${pos(e.date)}%` }}
            title={`${fmtDate(e.date, lang)} — ${e.label}`}
          />
        ))}
        <span className={styles.axisToday} style={{ left: `${todayPos}%` }} />
        <span className={styles.axisTodayLabel} style={{ left: `${Math.min(94, Math.max(6, todayPos))}%` }}>
          {u('vis.today')}
        </span>
        {showStart ? (
          <span className={styles.axisEdge} style={{ left: 0 }}>
            {fmtDate(first, lang)}
          </span>
        ) : null}
        {showEnd ? (
          <span className={styles.axisEdge} style={{ right: 0 }}>
            {fmtDate(last, lang)}
          </span>
        ) : null}
      </div>

      <ol className={styles.events}>
        {events.map((e, i) => {
          const days = daysFrom(today, e.date);
          const cls = i === nextIdx ? styles.eventNext : days < 0 ? styles.eventPast : '';
          return (
            <Fragment key={i}>
              {i === todayBefore ? (
                <li className={styles.todayRow} aria-hidden="true">
                  {u('vis.today')}, {fmtDate(today, lang)}
                </li>
              ) : null}
              <li className={`${styles.event} ${cls}`}>
                <span className={styles.eventDate}>{fmtDate(e.date, lang)}</span>
                <span className={styles.eventLabel} dir="auto">
                  {e.label}
                  {e.note ? <span className={styles.eventNote}>{e.note}</span> : null}
                </span>
                <span className={styles.eventRel}>{relDays(days, lang)}</span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
