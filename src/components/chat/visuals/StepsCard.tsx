import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import { visualAsText, type StepsVisual } from '@/lib/visuals';
import { CopyButton } from './CopyButton';
import { daysFrom, fmtDate, relDays, saveToCalendar, todayIso } from './visualUtils';
import styles from './visuals.module.css';

/**
 * План действий: шаги по порядку — что сделать, к какому сроку, кто и какие
 * документы. Шаги с точной датой — «через N дней» / «просрочено» и кнопка
 * «В календарь» (.ics с напоминаниями).
 */
export function StepsCard({ data }: { data: StepsVisual }) {
  const u = useUxT();
  const { lang } = useI18n();
  const title = data.title || u('vis.steps');
  const today = todayIso();
  const dated = data.steps.filter((s) => s.date);
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="listNumbered" size={16} />
        </span>
        <h4 className={styles.title} dir="auto">
          {title}
        </h4>
        <div className={styles.actions}>
          {dated.length ? (
            <button
              type="button"
              className={styles.btn}
              title={u('vis.toCalendar')}
              onClick={() => saveToCalendar(title, dated.map((s) => ({ date: s.date as string, title: s.title, description: s.detail })))}
            >
              <Icon name="calendar" size={14} />
              <span className={styles.btnText}>{u('vis.toCalendar')}</span>
            </button>
          ) : null}
          <CopyButton text={() => visualAsText({ kind: 'steps', data })} />
        </div>
      </div>
      <ol className={styles.steps}>
        {data.steps.map((s, i) => {
          const days = s.date ? daysFrom(today, s.date) : null;
          return (
            <li key={i} className={styles.step}>
              <span className={styles.num} aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <div className={styles.stepTitle} dir="auto">
                  {s.title}
                </div>
                {s.detail ? (
                  <div className={styles.stepDetail} dir="auto">
                    {s.detail}
                  </div>
                ) : null}
                {s.when || s.date || s.who || s.docs?.length ? (
                  <div className={styles.meta}>
                    {s.when || s.date ? (
                      <span className={styles.metaItem}>
                        <Icon name="clock" size={13} />
                        <span dir="auto">{[s.when, s.date ? fmtDate(s.date, lang) : ''].filter(Boolean).join(', ')}</span>
                        {days !== null ? (
                          <span className={days < 0 ? styles.late : days <= 7 ? styles.soon : undefined}>({relDays(days, lang)})</span>
                        ) : null}
                      </span>
                    ) : null}
                    {s.who ? (
                      <span className={styles.metaItem}>
                        <Icon name="users" size={13} />
                        <span dir="auto">{s.who}</span>
                      </span>
                    ) : null}
                    {s.docs?.length ? (
                      <span className={styles.metaItem}>
                        <Icon name="doc" size={13} />
                        <span dir="auto">{s.docs.join(', ')}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
