import { Fragment, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { ExpiryChip } from '@/components/contracts/ExpiryChip';
import { ObligationList } from '@/components/contracts/ObligationList';
import { contractsApi } from '@/api';
import { ApiError } from '@/api/util';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import type { ContractRow } from '@/types/domain';
import styles from './pages.module.css';

type Filter = 'all' | 'd30' | 'd60' | 'd90' | 'auto' | 'obligations';

const FILTERS: { id: Filter; key: string }[] = [
  { id: 'all', key: 'contracts.fAll' },
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
    new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const rows = useMemo(() => (data && !data.locked ? data.rows : []), [data]);

  const stats = useMemo(
    () => ({
      exp30: rows.filter((c) => c.terms.daysToExpiry !== null && c.terms.daysToExpiry <= 30).length,
      exp90: rows.filter((c) => c.terms.daysToExpiry !== null && c.terms.daysToExpiry <= 90).length,
      auto: rows.filter((c) => c.terms.autoRenew === true).length,
      openObligations: rows.reduce((n, c) => n + c.obligations.filter((o) => !o.done).length, 0),
    }),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((c) => {
        const d = c.terms.daysToExpiry;
        if (filter === 'd30') return d !== null && d <= 30;
        if (filter === 'd60') return d !== null && d <= 60;
        if (filter === 'd90') return d !== null && d <= 90;
        if (filter === 'auto') return c.terms.autoRenew === true;
        if (filter === 'obligations') return c.obligations.length > 0;
        return true;
      }),
    [rows, filter],
  );

  const statCards: { key: keyof typeof stats; icon: IconName; labelKey: string }[] = [
    { key: 'exp30', icon: 'clock', labelKey: 'contracts.exp30' },
    { key: 'exp90', icon: 'calendar', labelKey: 'contracts.exp90' },
    { key: 'auto', icon: 'history', labelKey: 'contracts.autoRenewals' },
    { key: 'openObligations', icon: 'check', labelKey: 'contracts.openObligations' },
  ];

  const obligationsLabel = (c: ContractRow): string =>
    c.obligations.length === 0 ? '—' : `${c.obligations.filter((o) => o.done).length}/${c.obligations.length}`;

  const toggleExpand = (c: ContractRow) => {
    if (c.obligations.length === 0) return;
    setExpanded((cur) => (cur === c.documentId ? null : c.documentId));
  };

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
      <TopBar title={t('contracts.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('contracts.title')}</h1>
            <p className={styles.pageSub}>{t('contracts.sub')}</p>
          </div>

          {loading ? (
            <SkeletonRows rows={4} height={96} />
          ) : locked ? (
            <EmptyState
              icon="calendar"
              title={t('contracts.upsellTitle')}
              body={t('contracts.upsellBody')}
              action={
                <Button variant="primary" icon="diamond" onClick={() => navigate('/plans')}>
                  {t('contracts.upsellCta')}
                </Button>
              }
            />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={t('contracts.empty')}
              body={t('contracts.emptyBody')}
              action={
                <Button variant="primary" icon="upload" onClick={() => navigate('/chat')}>
                  {t('contracts.emptyCta')}
                </Button>
              }
            />
          ) : (
            <>
              <div className={styles.statGrid}>
                {statCards.map((m) => (
                  <div key={m.key} className={styles.stat}>
                    <div className={styles.statLabel}>
                      <Icon name={m.icon} size={15} color="var(--accent)" />
                      {t(m.labelKey)}
                    </div>
                    <div className={styles.statValue}>{stats[m.key]}</div>
                  </div>
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
                    {t(f.key)}
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
                        {c.obligations.length > 0 ? (
                          <Icon
                            name="chevron"
                            size={16}
                            className={styles.metaText}
                            style={{
                              transform: expanded === c.documentId ? 'rotate(-90deg)' : 'rotate(90deg)',
                              transition: 'transform 0.15s ease',
                            }}
                          />
                        ) : null}
                      </div>
                      <div className={styles.rowCardBadges}>
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
                      {expanded === c.documentId ? (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ObligationList documentId={c.documentId} obligations={c.obligations} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.tableCard}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>{t('contracts.col.contract')}</th>
                        <th className={styles.th}>{t('contracts.col.expiry')}</th>
                        <th className={styles.th}>{t('contracts.col.auto')}</th>
                        <th className={`${styles.th} ${styles.hideSm}`}>{t('contracts.col.value')}</th>
                        <th className={`${styles.th} ${styles.hideSm}`}>{t('contracts.col.law')}</th>
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
                                <div style={{ minWidth: 0 }}>
                                  <div className={styles.docCellName} onClick={(e) => openDocument(e, c.documentId)}>
                                    {c.name}
                                  </div>
                                  <div className={styles.docCellSub}>{c.counterparty}</div>
                                </div>
                              </div>
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
                            <td className={`${styles.td} ${styles.hideSm}`}>{valueCell(c)}</td>
                            <td className={`${styles.td} ${styles.hideSm}`}>{c.terms.governingLaw ?? '—'}</td>
                            <td className={styles.td}>{obligationsLabel(c)}</td>
                            <td className={styles.td}>
                              {c.obligations.length > 0 ? (
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
                              ) : null}
                            </td>
                          </tr>
                          {expanded === c.documentId ? (
                            <tr>
                              <td className={styles.td} colSpan={7}>
                                <ObligationList documentId={c.documentId} obligations={c.obligations} />
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
