import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { analysisApi } from '@/api';
import { Button } from '@/components/ui/Button';
import { useAsync } from '@/hooks/useAsync';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import { prefillChatDraft, renewalInfo, type RenewalInfo, type RenewalMark } from '@/lib/renewal';
import { contractParagraphs, findRenewalClause, noticeSpan } from '@/lib/renewalClause';
import { useUIStore } from '@/store/useUIStore';
import type { ContractRow } from '@/types/domain';
import { activeMark, useCalendarDownload, useDateLabel, useLongDate, useMyName, useShortDate } from './uxHooks';
import styles from './ux.module.css';

/** «через 6 дн.» красным (≤7), жёлтым (≤30), дальше — серым текстом. */
export function DaysChip({ info, mark }: { info: RenewalInfo; mark?: RenewalMark | null }) {
  const u = useUxT();
  if (mark) {
    return (
      <span className={`${styles.chip} ${mark.kind === 'sent' ? styles.chipLow : styles.chipGrey}`}>
        {u(mark.kind === 'sent' ? 'rn.markSent' : 'rn.markKeep')}
      </span>
    );
  }
  if (info.kind !== 'notice') return null;
  const d = info.daysToLast;
  if (d < 0) return <span className={`${styles.chip} ${styles.chipGrey}`}>{u('rn.passed')}</span>;
  const text = d === 0 ? u('rn.today') : u('rn.inDays', { n: d });
  if (d <= 7) return <span className={`${styles.chip} ${styles.chipHigh}`}>{text}</span>;
  if (d <= 30) return <span className={`${styles.chip} ${styles.chipMed}`}>{text}</span>;
  return <span className={`${styles.muted} ${styles.small}`}>{text}</span>;
}

/** Клетка таблицы «Последний день отказа». */
export function RenewalCell({ row, mark }: { row: ContractRow; mark?: RenewalMark | null }) {
  const u = useUxT();
  const short = useShortDate();
  const info = renewalInfo(row.terms);
  if (info.kind === 'notice') {
    return (
      <span className={styles.renewCell}>
        <span>{short(info.last)}</span>
        <DaysChip info={info} mark={activeMark(info, mark)} />
      </span>
    );
  }
  if (info.kind === 'noRenew') return <span className={`${styles.muted} ${styles.small}`}>{u('rn.noRenewShort')}</span>;
  return <span className={styles.muted}>—</span>;
}

/**
 * «В договоре»: пункт о продлении дословно из текста последнего разбора
 * (lib/renewalClause, без ИИ). Не нашли уверенно — ничего не показываем.
 */
function ClauseQuote({ documentId, noticeDays, sampleText }: { documentId: string; noticeDays: number | null; sampleText?: string }) {
  const u = useUxT();
  const { data } = useAsync(
    async (signal) => {
      if (sampleText) return sampleText;
      const a = await analysisApi.latestForDocument(documentId, signal).catch(() => null);
      return a ? findRenewalClause(contractParagraphs(a), noticeDays) : null;
    },
    [documentId, noticeDays, sampleText],
  );
  if (!data) return null;
  const span = noticeSpan(data, noticeDays);
  return (
    <div className={styles.block}>
      <span className={styles.lbl}>{u('rn.inContract')}</span>
      <blockquote className={styles.quote} style={{ '--sev': 'var(--sev-med)' } as CSSProperties} dir="auto">
        {span ? (
          <>
            {data.slice(0, span[0])}
            <mark className={styles.hl}>{data.slice(span[0], span[1])}</mark>
            {data.slice(span[1])}
          </>
        ) : (
          data
        )}
      </blockquote>
      <span className={`${styles.muted} ${styles.small}`}>{u('rn.inContractNote')}</span>
    </div>
  );
}

/**
 * Раскрытая строка реестра: последний день отказа крупно, как он посчитан,
 * что будет, если ничего не делать, и действия: календарь, письмо, отметка.
 */
export function DeadlinePanel({
  row,
  mark,
  onMark,
  sample = false,
  sampleClause,
}: {
  row: ContractRow;
  mark?: RenewalMark | null;
  /** Сохранение на сервере; ошибка откатывает отметку (тост — здесь). */
  onMark: (m: RenewalMark | null) => void | Promise<void>;
  /** Образец: «Открыть договор» и письмо не уводят на несуществующие страницы. */
  sample?: boolean;
  /** Образец: готовый текст пункта (у образца нет разбора на сервере). */
  sampleClause?: string;
}) {
  const u = useUxT();
  const { t } = useI18n();
  const navigate = useNavigate();
  const long = useLongDate();
  const dateLabel = useDateLabel();
  const me = useMyName();
  const pushToast = useUIStore((s) => s.pushToast);
  const download = useCalendarDownload();
  const info = renewalInfo(row.terms);
  const current = activeMark(info, mark);

  const letter = () => {
    if (info.kind !== 'notice') return;
    if (sample) {
      pushToast(u('sm.banner'), 'default');
      return;
    }
    prefillChatDraft(u('rn.letterPrompt', { party: row.counterparty || '—', name: row.name, end: long(info.end), last: long(info.last) }));
    navigate('/chat');
  };

  const saveMark = (m: RenewalMark | null) =>
    void Promise.resolve(onMark(m)).then(
      () => pushToast(u('rn.marked'), 'default'),
      (err: unknown) => pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error'),
    );

  const setMark = (kind: 'sent' | 'keep') => {
    if (info.kind !== 'notice') return;
    saveMark({ kind, who: me, at: new Date().toISOString(), last: info.last });
  };

  let main;
  if (info.kind === 'notice') {
    main = (
      <>
        <span className={styles.lbl}>{u('rn.panelTitle')}</span>
        <p className={styles.bigDate}>{long(info.last)}</p>
        <div className={styles.row}>
          <DaysChip info={info} mark={current} />
        </div>
        <p className={styles.calc}>{u('rn.calc', { end: long(info.end), n: info.notice })}</p>
        <p className={styles.ifNothing}>
          {info.daysToLast < 0 ? (
            u('rn.passedText', { date: long(info.last) })
          ) : (
            <>
              <b>{u('rn.ifNothing')}</b> {u('rn.renews')}
            </>
          )}
        </p>
      </>
    );
  } else if (info.kind === 'noRenew') {
    main = <p className={styles.ifNothing}>{u('rn.noRenew', { date: long(info.end) })}</p>;
  } else if (info.kind === 'noNotice') {
    main = <p className={styles.note}>{u('rn.noNotice')}</p>;
  } else {
    main = <p className={styles.note}>{u('rn.noDate')}</p>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelMain}>
        {main}
        {info.kind === 'notice' || info.kind === 'noNotice' ? (
          <ClauseQuote documentId={row.documentId} noticeDays={info.kind === 'notice' ? info.notice : null} sampleText={sampleClause} />
        ) : null}
      </div>
      <div className={styles.panelSide}>
        <div className={styles.row}>
          {info.kind !== 'unknown' ? (
            <Button variant="secondary" size="sm" icon="calendar" onClick={() => download([row], `lexab-${row.name.slice(0, 40)}`)}>
              {u('rn.ics')}
            </Button>
          ) : null}
          {info.kind === 'notice' && info.daysToLast >= 0 ? (
            <Button variant="secondary" size="sm" icon="pen" onClick={letter}>
              {u('rn.letter')}
            </Button>
          ) : null}
          {!sample ? (
            <Button variant="ghost" size="sm" icon="docs" onClick={() => navigate(`/documents/${row.documentId}`)}>
              {u('rn.openDoc')}
            </Button>
          ) : null}
        </div>
        {info.kind === 'notice' ? (
          <div className={styles.decision}>
            {current ? (
              <>
                <div className={styles.decRec}>
                  <DaysChip info={info} mark={current} />
                  <span className={styles.decWho}>
                    <b>{current.who}</b> <span className={styles.muted}>{dateLabel(current.at)}</span>
                  </span>
                </div>
                <button type="button" className={styles.link} style={{ alignSelf: 'flex-start' }} onClick={() => saveMark(null)}>
                  {u('rn.undo')}
                </button>
              </>
            ) : (
              <>
                <span className={styles.lbl}>{u('rn.markLbl')}</span>
                <div className={styles.row}>
                  <Button variant="secondary" size="sm" icon="check" onClick={() => setMark('sent')}>
                    {u('rn.markSent')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setMark('keep')}>
                    {u('rn.markKeep')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
