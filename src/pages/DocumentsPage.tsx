import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { RiskBadge, Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { documentsApi, projectsApi } from '@/api';
import type { ContractDocument, ContractStatus, Project } from '@/types/domain';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

const STATUS_FILTERS = ['All', 'Draft', 'In review', 'Reviewed', 'Signed'];
const RISK_FILTERS = ['All', 'Low', 'Elevated', 'High'];
const PAGE_SIZE = 5;
const RISK_ORDER: Record<string, number> = { Low: 0, Elevated: 1, High: 2 };

const STATUS_TONE: Record<ContractStatus, string> = {
  Draft: 'var(--mut)',
  'In review': 'var(--sev-med)',
  Reviewed: 'var(--chart-accent)',
  Signed: 'var(--sev-low)',
};

type SortKey = 'name' | 'status' | 'risk' | 'updatedAt';
type SortDir = 'asc' | 'desc';

/** Contracts list with search, filters, sortable columns and pagination. */
export function DocumentsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 700px)');
  usePageTitle(t('nav.documents'));
  const [search, setSearch] = useState('');
  // Debounced value that actually drives the request — the input stays fully
  // responsive, but the server-side full-content search (which decrypts the
  // user's documents) fires only after typing pauses, not on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  const [status, setStatus] = useState('All');
  const [risk, setRisk] = useState('All');
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const timeAgo = (iso: string): string => {
    // Full elapsed days (floor): anything under 24h is still "today".
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return t('docs.today');
    if (days === 1) return t('docs.yesterday');
    return t('docs.daysAgo', { n: days });
  };

  const query = useMemo(() => ({ search: debouncedSearch, status, risk }), [debouncedSearch, status, risk]);
  const { data, loading, error, reload, mutate } = useAsync(
    (signal) => documentsApi.list(query, signal),
    [query.search, query.status, query.risk],
  );

  // «В проект…»: модалка-выбор дела для конкретного документа. Проекты
  // грузятся при первом открытии (дальше — из кэша useAsync).
  const pushToast = useUIStore((s) => s.pushToast);
  const [pickFor, setPickFor] = useState<ContractDocument | null>(null);
  const [pickBusy, setPickBusy] = useState(false);
  const projects = useAsync(
    (signal) => (pickFor ? projectsApi.list(signal) : Promise.resolve([] as Project[])),
    [pickFor !== null],
  );

  const assignTo = async (projectId: string | null) => {
    if (!pickFor || pickBusy) return;
    setPickBusy(true);
    try {
      const updated = await documentsApi.assignProject(pickFor.id, projectId);
      mutate((rows) => (rows ?? []).map((r) => (r.id === updated.id ? { ...r, projectId: updated.projectId ?? projectId } : r)));
      pushToast(projectId ? t('projects.addedToast') : t('projects.removedToast'), projectId ? 'success' : 'default');
      setPickFor(null);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setPickBusy(false);
    }
  };

  /** Кнопка «В проект…» в строке — только для СВОИХ документов (перенос в
   *  дело доступен владельцу; чужие расшаренные сервер не даст двигать). */
  const toProjectBtn = (d: ContractDocument) =>
    d.sharedBy ? null : (
      <IconButton
        icon="folder"
        label={t('projects.toProject')}
        title={t('projects.toProject')}
        size="sm"
        iconSize={15}
        onClick={(e) => {
          e.stopPropagation();
          setPickFor(d);
        }}
      />
    );

  const sorted = useMemo(() => {
    const rows = [...(data ?? [])];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'risk') cmp = RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
      else if (sortKey === 'updatedAt') cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      else cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  const sortableTh = (key: SortKey, label: string, extra = '') => (
    <th className={`${styles.th} ${styles.thSortable} ${extra}`} onClick={() => toggleSort(key)}>
      {label}
      {sortKey === key ? <span className={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
    </th>
  );

  return (
    <div className={styles.page}>
      <TopBar title={t('docs.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead} ref={useReveal()}>
            <h1 className={styles.pageTitle}>{t('docs.title')}</h1>
            <p className={styles.pageSub}>{t('docs.sub')}</p>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}>
                <Icon name="search" size={16} />
              </span>
              <input
                className={styles.searchInput}
                placeholder={t('docs.search')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <SelectMenu
              ariaLabel="status"
              value={status}
              options={STATUS_FILTERS.map((s) => ({ value: s, label: s === 'All' ? t('docs.allStatuses') : t(`status.${s}`) }))}
              onChange={(v) => {
                setStatus(v);
                setPage(0);
              }}
            />
            <SelectMenu
              ariaLabel="risk"
              value={risk}
              options={RISK_FILTERS.map((r) => ({ value: r, label: r === 'All' ? t('docs.allRisk') : t(`risk.${r}`) }))}
              onChange={(v) => {
                setRisk(v);
                setPage(0);
              }}
            />
          </div>

          {loading ? (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <tbody>
                  {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <tr key={i}>
                      <td className={styles.td} colSpan={6}>
                        <div className={styles.skeleton} style={{ height: 20, width: `${60 + ((i * 7) % 30)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : sorted.length === 0 ? (
            <EmptyState icon="docs" title={t('docs.empty')} body={t('docs.emptyBody')} />
          ) : isMobile ? (
            <>
              <div className={styles.rowCards}>
                {pageRows.map((d) => (
                  <div key={d.id} className={styles.rowCard} onClick={() => navigate(`/documents/${d.id}`)}>
                    <div className={styles.rowCardHead}>
                      <div className={styles.docCellIcon}>
                        <Icon name="docs" size={16} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className={styles.docCellName}>{d.name}</div>
                        <div className={styles.docCellSub}>
                          {d.sharedBy ? `${t('docs.fromTeam', { name: d.sharedBy })} · ` : ''}
                          {d.counterparty}
                        </div>
                      </div>
                      {toProjectBtn(d)}
                    </div>
                    <div className={styles.rowCardBadges}>
                      <Badge color={STATUS_TONE[d.status]} plain>{t(`status.${d.status}`)}</Badge>
                      <RiskBadge risk={d.risk} plain />
                    </div>
                    <div className={styles.rowCardMeta}>
                      <span>{d.jurisdiction}</span>
                      <span>{timeAgo(d.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.pagination}>
                <span className={styles.paginationInfo}>{t('docs.count', { n: sorted.length })}</span>
                <div className={styles.paginationControls}>
                  <button
                    className={styles.pageBtn}
                    disabled={clampedPage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    {t('docs.prev')}
                  </button>
                  <span className={styles.pageOf}>{t('docs.pageOf', { page: clampedPage + 1, total: totalPages })}</span>
                  <button
                    className={styles.pageBtn}
                    disabled={clampedPage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    {t('docs.next')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.tableCard}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {sortableTh('name', t('docs.col.document'))}
                      {sortableTh('status', t('docs.col.status'), styles.hideSm)}
                      {sortableTh('risk', t('docs.col.risk'))}
                      <th className={`${styles.th} ${styles.hideSm}`}>{t('docs.col.jurisdiction')}</th>
                      {sortableTh('updatedAt', t('docs.col.updated'), styles.hideSm)}
                      <th className={styles.th} aria-label={t('projects.toProject')} />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((d) => (
                      <tr key={d.id} className={styles.tr} onClick={() => navigate(`/documents/${d.id}`)}>
                        <td className={styles.td}>
                          <div className={styles.docCell}>
                            <div className={styles.docCellIcon}>
                              <Icon name="docs" size={16} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div className={styles.docCellName}>{d.name}</div>
                              <div className={styles.docCellSub}>
                                {d.sharedBy ? `${t('docs.fromTeam', { name: d.sharedBy })} · ` : d.teamShared ? `${t('docs.teamBadge')} · ` : ''}
                                {d.counterparty}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={`${styles.td} ${styles.hideSm}`}>
                          <Badge color={STATUS_TONE[d.status]} plain>{t(`status.${d.status}`)}</Badge>
                        </td>
                        <td className={styles.td}>
                          <RiskBadge risk={d.risk} plain />
                        </td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.mono}`}>{d.jurisdiction}</td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>{timeAgo(d.updatedAt)}</td>
                        <td className={styles.td} style={{ width: 44 }}>{toProjectBtn(d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.pagination}>
                <span className={styles.paginationInfo}>{t('docs.count', { n: sorted.length })}</span>
                <div className={styles.paginationControls}>
                  <button
                    className={styles.pageBtn}
                    disabled={clampedPage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    {t('docs.prev')}
                  </button>
                  <span className={styles.pageOf}>{t('docs.pageOf', { page: clampedPage + 1, total: totalPages })}</span>
                  <button
                    className={styles.pageBtn}
                    disabled={clampedPage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    {t('docs.next')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* «В проект…» — выбор дела для документа. */}
      <Modal open={pickFor !== null} title={t('projects.pickTitle')} onClose={() => !pickBusy && setPickFor(null)} maxWidth={460}>
        {projects.loading ? (
          <SkeletonRows rows={3} height={40} />
        ) : projects.error ? (
          <ErrorState message={projects.error} onRetry={projects.reload} />
        ) : (projects.data ?? []).length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className={styles.pageSub} style={{ margin: 0 }}>{t('projects.pickEmpty')}</p>
            <div>
              <Button variant="secondary" icon="folder" onClick={() => navigate('/projects')}>
                {t('projects.title')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {pickFor?.projectId ? (
              <button type="button" className={styles.projPickRow} disabled={pickBusy} onClick={() => void assignTo(null)}>
                <Icon name="x" size={15} />
                <span>{t('projects.removeFromProject')}</span>
              </button>
            ) : null}
            {(projects.data ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.projPickRow}
                disabled={pickBusy || pickFor?.projectId === p.id}
                onClick={() => void assignTo(p.id)}
              >
                <Icon name="folder" size={16} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span className={styles.projPickMeta}>
                  {pickFor?.projectId === p.id ? t('projects.current') : t('projects.docsCount', { n: p.docsCount })}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
