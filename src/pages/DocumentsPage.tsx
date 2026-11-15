import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { RiskBadge, Badge } from '@/components/ui/Badge';
import { VaultHeader } from '@/components/vault/VaultHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { SampleDocuments } from '@/components/ux/SampleVault';
import { FileCard, FileCardSkeleton } from '@/components/ux/FileCard';
import { previewFromMarkdown, useDocPreviews } from '@/lib/docPreviews';
import { localeFor } from '@/i18n/dates';
import { useAsync } from '@/hooks/useAsync';
import { invalidateVaultCounts } from '@/hooks/useVaultCounts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { documentsApi, projectsApi, savedDocsApi } from '@/api';
import type { ContractDocument, Project, SavedDoc } from '@/types/domain';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

const STATUS_FILTERS = ['All', 'Draft', 'In review', 'Reviewed', 'Signed'];
const RISK_FILTERS = ['All', 'Low', 'Elevated', 'High'];
// 12 — ровно 3, 2 или 1 ряд карточек без «дырки» в последнем ряду.
const PAGE_SIZE = 12;
const RISK_ORDER: Record<string, number> = { Low: 0, Elevated: 1, High: 2 };

type SortKey = 'name' | 'risk' | 'updatedAt';
type SortDir = 'asc' | 'desc';
/** Порядок карточек (вместо сортировки по столбцам таблицы). */
const SORTS: { value: string; key: SortKey; dir: SortDir; label: string }[] = [
  { value: 'new', key: 'updatedAt', dir: 'desc', label: 'docs.sort.new' },
  { value: 'risk', key: 'risk', dir: 'desc', label: 'docs.sort.risk' },
  { value: 'name', key: 'name', dir: 'asc', label: 'docs.sort.name' },
];

/** Карточка списка: договор или документ, сохранённый из чата. */
type Card =
  | { kind: 'doc'; key: string; name: string; at: string; riskRank: number; doc: ContractDocument }
  | { kind: 'saved'; key: string; name: string; at: string; riskRank: number; saved: SavedDoc };

/** Сохранённый из чата документ — это черновик без проверки рисков: он виден
 *  при фильтре «Все» и «Черновик», без фильтра по риску; поиск — по названию
 *  и тексту (как у договоров, только на месте: текст уже здесь). */
function savedMatches(s: SavedDoc, q: { search: string; status: string; risk: string }): boolean {
  if (q.status !== 'All' && q.status !== 'Draft') return false;
  if (q.risk !== 'All') return false;
  const needle = q.search.trim().toLowerCase();
  return !needle || s.title.toLowerCase().includes(needle) || s.content.toLowerCase().includes(needle);
}

/** «Сегодня» → «сегодня» после запятой. Только первая буква: в немецком
 *  существительные внутри («vor 6 Tagen») остаются с заглавной. */
const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase() + s.slice(1);

/** Vault → Documents: договоры и сохранённые из чата документы карточками
 *  (эталон владельца) — фильтр по статусу, поиск, риск, порядок и страницы. */
export function DocumentsPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
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
  const [sortValue, setSortValue] = useState('new');
  const { key: sortKey, dir: sortDir } = SORTS.find((x) => x.value === sortValue) ?? SORTS[0];
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
  // Сохранённые из чата документы: сбой списка не прячет договоры.
  const savedDocs = useAsync((signal) => savedDocsApi.list(signal).catch(() => [] as SavedDoc[]), []);
  const adoptDraft = useChatStore((s) => s.adoptDraft);
  const openSaved = (s: SavedDoc) => {
    adoptDraft({ id: s.id, title: s.title, content: s.content });
    navigate('/workspace');
  };

  // «В проект…»: модалка-выбор дела для конкретного документа. Проекты
  // грузятся при первом открытии (дальше — из кэша useAsync).
  const pushToast = useUIStore((s) => s.pushToast);

  // Удаление сохранённого документа — с подтверждением: вернуть его нельзя.
  const [deleteFor, setDeleteFor] = useState<SavedDoc | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const removeSaved = async () => {
    if (!deleteFor || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await savedDocsApi.remove(deleteFor.id);
      const id = deleteFor.id;
      savedDocs.mutate((rows) => (rows ?? []).filter((r) => r.id !== id));
      invalidateVaultCounts();
      pushToast(t('docs.savedDeleted'), 'default');
      setDeleteFor(null);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

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
        onClick={() => setPickFor(d)}
      />
    );

  const sorted = useMemo(() => {
    const rows: Card[] = [
      ...(data ?? []).map((d): Card => ({ kind: 'doc', key: `d:${d.id}`, name: d.name, at: d.updatedAt, riskRank: RISK_ORDER[d.risk] ?? 0, doc: d })),
      ...(savedDocs.data ?? [])
        .filter((x) => savedMatches(x, query))
        // У сохранённого нет оценки риска — в порядке «высокий риск» он ниже всех.
        .map((x): Card => ({ kind: 'saved', key: `s:${x.id}`, name: x.title, at: x.createdAt, riskRank: -1, saved: x })),
    ];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'risk') cmp = a.riskRank - b.riskRank;
      else if (sortKey === 'updatedAt') cmp = new Date(a.at).getTime() - new Date(b.at).getTime();
      else cmp = a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, savedDocs.data, query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);
  // Превью только для карточек текущей страницы — один запрос на страницу.
  const previews = useDocPreviews(
    pageRows.flatMap((c) => (c.kind === 'doc' ? [{ id: c.doc.id, updatedAt: c.doc.updatedAt }] : [])),
  );
  const savedPreviews = useMemo(
    () => new Map((savedDocs.data ?? []).map((x) => [x.id, previewFromMarkdown(x.content)])),
    [savedDocs.data],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric' }),
    [lang],
  );

  return (
    <div className={styles.page}>
      <TopBar title={t('nav.documents')} hideCountry />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <VaultHeader active="documents" />

          <div className={styles.vaultToolbar}>
            <div className={styles.segmented} role="tablist" aria-label={t('docs.col.status')}>
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={status === s}
                  className={status === s ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
                  onClick={() => {
                    setStatus(s);
                    setPage(0);
                  }}
                >
                  {s === 'All' ? t('docs.filterAll') : t(`status.${s}`)}
                </button>
              ))}
            </div>
            <div className={styles.vaultToolbarRight}>
              <div className={`${styles.searchWrap} ${styles.vaultSearch}`}>
                <span className={styles.searchIcon}>
                  <Icon name="search" size={16} />
                </span>
                <input
                  className={styles.searchInput}
                  placeholder={t('docs.searchShort')}
                  aria-label={t('docs.search')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <SelectMenu
                ariaLabel="risk"
                value={risk}
                options={RISK_FILTERS.map((r) => ({ value: r, label: r === 'All' ? t('docs.allRisk') : t(`risk.${r}`) }))}
                onChange={(v) => {
                  setRisk(v);
                  setPage(0);
                }}
              />
              <SelectMenu
                ariaLabel="sort"
                value={sortValue}
                options={SORTS.map((x) => ({ value: x.value, label: t(x.label) }))}
                onChange={(v) => {
                  setSortValue(v);
                  setPage(0);
                }}
              />
            </div>
          </div>

          {loading || savedDocs.loading ? (
            <div className={styles.docGallery}>
              {Array.from({ length: 6 }).map((_, i) => (
                <FileCardSkeleton key={i} variant="gallery" />
              ))}
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : sorted.length === 0 ? (
            // ui-test 15.11: образец — только когда документов нет совсем; пустой
            // результат поиска/фильтра остаётся прежним «ничего не найдено».
            !search.trim() && status === 'All' && risk === 'All' ? (
              <SampleDocuments />
            ) : (
              <EmptyState icon="docs" title={t('docs.empty')} body={t('docs.emptyBody')} />
            )
          ) : (
            <>
              <div className={styles.docGallery}>
                {pageRows.map((card) => {
                  if (card.kind === 'saved') {
                    const sv = card.saved;
                    return (
                      <FileCard
                        key={card.key}
                        variant="gallery"
                        kindOf="saved.docx"
                        title={sv.title}
                        paperTitle={sv.title}
                        paperMeta={dateFmt.format(new Date(sv.createdAt))}
                        preview={savedPreviews.get(sv.id) ?? null}
                        sub={`${t('docs.savedFromChat')}, ${lowerFirst(timeAgo(sv.createdAt))}`}
                        aside={<Badge>{t('docs.notReviewed')}</Badge>}
                        onOpen={() => openSaved(sv)}
                        actions={
                          <IconButton
                            icon="trash"
                            label={t('docs.deleteSaved')}
                            title={t('docs.deleteSaved')}
                            size="sm"
                            iconSize={15}
                            onClick={() => setDeleteFor(sv)}
                          />
                        }
                      />
                    );
                  }
                  const d = card.doc;
                  const team = d.sharedBy ? t('docs.fromTeam', { name: d.sharedBy }) : d.teamShared ? t('docs.teamBadge') : '';
                  const party = d.counterparty && d.counterparty !== '—' ? d.counterparty : '';
                  return (
                    <FileCard
                      key={card.key}
                      variant="gallery"
                      kindOf={d.name}
                      title={d.name}
                      paperTitle={d.name.replace(/\.[a-z0-9]{1,5}$/i, '')}
                      paperMeta={party || dateFmt.format(new Date(d.updatedAt))}
                      preview={previews.get(d.id)}
                      sub={[team, t(`status.${d.status}`), lowerFirst(timeAgo(d.updatedAt))].filter(Boolean).join(', ')}
                      aside={<RiskBadge risk={d.risk} />}
                      onOpen={() => navigate(`/documents/${d.id}`)}
                      actions={toProjectBtn(d)}
                    />
                  );
                })}
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

      {/* Удалить сохранённый из чата документ. */}
      <Modal
        open={deleteFor !== null}
        title={t('docs.deleteSavedTitle')}
        onClose={() => !deleteBusy && setDeleteFor(null)}
        maxWidth={440}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <Button variant="ghost" disabled={deleteBusy} onClick={() => setDeleteFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="trash" disabled={deleteBusy} onClick={() => void removeSaved()}>
              {deleteBusy ? t('common.loading') : t('docs.deleteSaved')}
            </Button>
          </div>
        }
      >
        <p className={styles.pageSub} style={{ margin: 0 }}>
          {t('docs.deleteSavedBody', { name: deleteFor?.title ?? '' })}
        </p>
      </Modal>

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
