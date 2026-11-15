import { Fragment, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { VaultHeader } from '@/components/vault/VaultHeader';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CountUp } from '@/components/ui/CountUp';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { ExpiryChip } from '@/components/contracts/ExpiryChip';
import { ObligationList } from '@/components/contracts/ObligationList';
import { DeadlinePanel, RenewalCell } from '@/components/ux/Deadline';
import { activeMark, useCalendarDownload } from '@/components/ux/uxHooks';
import { SampleContracts } from '@/components/ux/Samples';
import ux from '@/components/ux/ux.module.css';
import { useUxT } from '@/i18n/uxMessages';
import { hasCalendarDate, needsAction, renewalInfo, useRenewalMarks } from '@/lib/renewal';
import { contractsApi } from '@/api';
import { ApiError } from '@/api/util';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
import type { ContractRow } from '@/types/domain';
import { Reveal } from './Reveal';
import styles from './pages.module.css';

type Filter = 'all' | 'act' | 'd30' | 'd60' | 'd90' | 'auto' | 'obligations';

const FILTERS: { id: Filter; key: string }[] = [
  { id: 'all', key: 'contracts.fAll' },
  { id: 'act', key: 'rn.filterAct' },
  { id: 'd30', key: 'contracts.f30' },
  { id: 'd60', key: 'contracts.f60' },
  { id: 'd90', key: 'contracts.f90' },
  { id: 'auto', key: 'contracts.fAuto' },
  { id: 'obligations', key: 'contracts.fObl' },
];

/**
 * Contract lifecycle register: expiry dates, auto-renewals and obligations
 * extracted from analysed contracts. Pro+ feature — the API answers 402 on
 * lower plans, surfaced here as an upsell.
 */
export function ContractsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 700px)');
  usePageTitle(t('contracts.title'));

  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  // useAsync: revisiting the section renders instantly from the session cache
  // and revalidates silently — no skeleton on return. The 402 "not on Pro+"
  // answer is a VIEW (not an error) so it caches too; buying a plan calls
  // clearAsyncCache(), which re-runs every mounted fetcher.
  const { data, loading, error, reload } = useAsync<{ locked: true } | { locked: false; rows: ContractRow[] }>(
    async (signal) => {
      try {
        return { locked: false, rows: await contractsApi.list(signal) };
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) return { locked: true };
        throw err;
      }
    },
    [],
  );
  const locked = data?.locked === true;

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(localeFor(lang), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const rows = useMemo(() => (data && !data.locked ? data.rows : []), [data]);

  // ui-test 15.11: «последний день отказа» = окончание − срок уведомления.
  const u = useUxT();
  const { map: marks, set: setMark } = useRenewalMarks(rows);
  const downloadCalendar = useCalendarDownload();
  const mustAct = (c: ContractRow) => {
    const info = renewalInfo(c.terms);
    return needsAction(info) && !activeMark(info, marks[c.documentId]);
  };
  const actCount = rows.filter(mustAct).length;
  // Есть ли вообще сроки продления / даты для календаря — иначе не обещаем
  // «отказ не нужен» и не показываем кнопку, которая ничего не скачает.
  const hasRenewalTerms = rows.some((c) => renewalInfo(c.terms).kind === 'notice');
  const hasDates = rows.some((c) => hasCalendarDate(c.terms));
  const sortKey = (c: ContractRow): string => {
    const info = renewalInfo(c.terms);
    if (info.kind === 'notice') return info.daysToLast < 0 ? `2${info.end}` : `1${info.last}`;
    return info.kind === 'unknown' ? '9' : `2${info.end}`;
  };

  const stats = useMemo(
    () => ({
      exp30: rows.filter((c) => c.terms.daysToExpiry !== null && c.terms.daysToExpiry <= 30).length,
      exp90: rows.filter((c) => c.terms.daysToExpiry !== null && c.terms.daysToExpiry <= 90).length,
      auto: rows.filter((c) => c.terms.autoRenew === true).length,
      openObligations: rows.reduce((n, c) => n + c.obligations.filter((o) => !o.done).length, 0),
    }),
    [rows],
  );

  // Без useMemo: фильтр «Действовать» зависит и от отметок (marks), а строк — десятки.
  const filtered = rows
    .filter((c) => {
      const d = c.terms.daysToExpiry;
      if (filter === 'act') return mustAct(c);
      if (filter === 'd30') return d !== null && d <= 30;
      if (filter === 'd60') return d !== null && d <= 60;
      if (filter === 'd90') return d !== null && d <= 90;
      if (filter === 'auto') return c.terms.autoRenew === true;
      if (filter === 'obligations') return c.obligations.length > 0;
      return true;
    })
    // Ближайший последний день отказа — первым (как в календаре продлений).
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const statCards: { key: keyof typeof stats; icon: IconName; labelKey: string }[] = [
    { key: 'exp30', icon: 'clock', labelKey: 'contracts.exp30' },
    { key: 'exp90', icon: 'calendar', labelKey: 'contracts.exp90' },
    { key: 'auto', icon: 'history', labelKey: 'contracts.autoRenewals' },
    { key: 'openObligations', icon: 'check', labelKey: 'contracts.openObligations' },
  ];

  const obligationsLabel = (c: ContractRow): string =>
    c.obligations.length === 0 ? '—' : `${c.obligations.filter((o) => o.done).length}/${c.obligations.length}`;

  // Раскрывается любая строка: там «последний день отказа», календарь и отметки.
  const toggleExpand = (c: ContractRow) => {
    setExpanded((cur) => (cur === c.documentId ? null : c.documentId));
  };

  const expandedBody = (c: ContractRow) => (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DeadlinePanel row={c} mark={marks[c.documentId]} onMark={(m) => setMark(c.documentId, m)} />
      {c.obligations.length > 0 ? <ObligationList documentId={c.documentId} obligations={c.obligations} /> : null}
    </div>
  );

  const openDocument = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    navigate(`/documents/${id}`);
  };

  const autoRenewCell = (c: ContractRow) =>
    c.terms.autoRenew ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge color="accent">{t('contracts.autoBadge')}</Badge>
        {c.terms.renewalNoticeDays != null ? (
          <span className={styles.metaText}>{t('contracts.noticeDays', { n: c.terms.renewalNoticeDays })}</span>
        ) : null}
      </span>
    ) : (
      '—'
    );

  const valueCell = (c: ContractRow): string =>
    c.terms.contractValue ? `${c.terms.contractValue}${c.terms.currency ? ` ${c.terms.currency}` : ''}` : '—';

  return (
    <div className={styles.page}>
      <TopBar title={t('nav.documents')} hideCountry />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <VaultHeader active="contracts" />

          {loading ? (
            <SkeletonRows rows={4} height={96} />
          ) : locked ? (
            // ui-test 15.11: вместо текста «на тарифе Pro» — образец, который можно потрогать.
            <SampleContracts locked />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <SampleContracts locked={false} />
          ) : (
            <>
              <div className={ux.summary}>
                <span className={ux.summaryText}>
                  {actCount ? (
                    <>
                      {u('rn.summary', { n: '' }).replace(/\s*$/, ' ')}
                      <b>{actCount}</b>
                    </>
                  ) : (
                    u(hasRenewalTerms ? 'rn.summaryNone' : 'rn.summaryNoData')
                  )}
                </span>
                {hasDates ? (
                  <Button variant="secondary" size="sm" icon="calendar" onClick={() => downloadCalendar(rows, 'lexab-contract-dates')}>
                    {u('rn.allIcs')}
                  </Button>
                ) : null}
              </div>

              <div className={styles.statGrid}>
                {statCards.map((m, i) => (
                  <Reveal key={m.key} delay={i * 0.06} className={styles.stat}>
                    <div className={styles.statLabel}>
                      <Icon name={m.icon} size={15} color="var(--accent)" />
                      {t(m.labelKey)}
                    </div>
                    <div className={styles.statValue}>
                      <CountUp to={stats[m.key]} />
                    </div>
                  </Reveal>
                ))}
              </div>

              <div className={styles.segRow} style={{ flexWrap: 'wrap', marginBottom: 18 }}>
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`${styles.segBtn} ${filter === f.id ? styles.segBtnActive : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.id === 'act' ? `${u(f.key)} ${actCount}` : t(f.key)}
                  </button>
                ))}
              </div>

              {filtered.length === 0 ? (
                <p className={styles.panelEmpty}>{t('contracts.noneMatch')}</p>
              ) : isMobile ? (
                <div className={styles.rowCards}>
                  {filtered.map((c) => (
                    <div key={c.documentId} className={styles.rowCard} onClick={() => toggleExpand(c)}>
                      <div className={styles.rowCardHead}>
                        <div className={styles.docCellIcon}>
                          <Icon name="calendar" size={16} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className={styles.docCellName} onClick={(e) => openDocument(e, c.documentId)}>
                            {c.name}
                          </div>
                          <div className={styles.docCellSub}>{c.counterparty}</div>
                        </div>
                        <Icon
                          name="chevron"
                          size={16}
                          className={styles.metaText}
                          style={{
                            transform: expanded === c.documentId ? 'rotate(-90deg)' : 'rotate(90deg)',
                            transition: 'transform 0.15s ease',
                          }}
                        />
                      </div>
                      <div className={styles.rowCardBadges}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span className={styles.metaText}>{u('rn.col')}:</span>
                          <RenewalCell row={c} mark={marks[c.documentId]} />
                        </span>
                        {c.terms.expiryDate ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span className={styles.metaText}>{formatDate(c.terms.expiryDate)}</span>
                            <ExpiryChip days={c.terms.daysToExpiry} />
                          </span>
                        ) : null}
                        {autoRenewCell(c)}
                      </div>
                      <div className={styles.rowCardMeta}>
                        <span>{valueCell(c)}</span>
                        <span>{c.terms.governingLaw ?? '—'}</span>
                        <span>
                          {t('contracts.col.obligations')}: {obligationsLabel(c)}
                        </span>
                      </div>
                      {expanded === c.documentId ? expandedBody(c) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.tableCard}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>{t('contracts.col.contract')}</th>
                        <th className={styles.th}>{u('rn.col')}</th>
                        <th className={styles.th}>{t('contracts.col.expiry')}</th>
                        <th className={styles.th}>{t('contracts.col.auto')}</th>
                        <th className={`${styles.th} ${styles.hideSm} ${ux.hideMd}`}>{t('contracts.col.value')}</th>
                        <th className={`${styles.th} ${styles.hideSm} ${ux.hideMd}`}>{t('contracts.col.law')}</th>
                        <th className={styles.th}>{t('contracts.col.obligations')}</th>
                        <th className={styles.th} aria-hidden="true" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => (
                        <Fragment key={c.documentId}>
                          <tr className={styles.tr} onClick={() => toggleExpand(c)}>
                            <td className={styles.td}>
                              <div className={styles.docCell}>
                                <div className={styles.docCellIcon}>
                                  <Icon name="docs" size={16} />
                                </div>
                                {/* Имя файла без пробелов (Design_Services_Agreement.docx) не
                                    переносилось и растягивало таблицу шире рамки. */}
                                <div className={ux.nameBox}>
                                  <div className={styles.docCellName} onClick={(e) => openDocument(e, c.documentId)}>
                                    {c.name}
                                  </div>
                                  <div className={styles.docCellSub}>{c.counterparty}</div>
                                </div>
                              </div>
                            </td>
                            <td className={styles.td}>
                              <RenewalCell row={c} mark={marks[c.documentId]} />
                            </td>
                            <td className={styles.td}>
                              {c.terms.expiryDate ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span className={styles.metaText}>{formatDate(c.terms.expiryDate)}</span>
                                  <ExpiryChip days={c.terms.daysToExpiry} />
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className={styles.td}>{autoRenewCell(c)}</td>
                            <td className={`${styles.td} ${styles.hideSm} ${ux.hideMd}`}>{valueCell(c)}</td>
                            <td className={`${styles.td} ${styles.hideSm} ${ux.hideMd}`}>{c.terms.governingLaw ?? '—'}</td>
                            <td className={styles.td}>{obligationsLabel(c)}</td>
                            <td className={styles.td}>
                              <button
                                type="button"
                                className={styles.pageBtn}
                                aria-label={t('contracts.showObligations')}
                                aria-expanded={expanded === c.documentId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(c);
                                }}
                              >
                                <Icon
                                  name="chevron"
                                  size={14}
                                  style={{
                                    transform: expanded === c.documentId ? 'rotate(-90deg)' : 'rotate(90deg)',
                                    transition: 'transform 0.15s ease',
                                  }}
                                />
                              </button>
                            </td>
                          </tr>
                          {expanded === c.documentId ? (
                            <tr>
                              <td className={styles.td} colSpan={8}>
                                {expandedBody(c)}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
