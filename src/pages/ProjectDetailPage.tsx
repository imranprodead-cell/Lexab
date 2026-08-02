import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { RiskBadge, Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { setPendingProject, documentsApi, projectsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { ContractDocument, ContractStatus } from '@/types/domain';
import styles from './pages.module.css';

const STATUS_TONE: Record<ContractStatus, string> = {
  Draft: 'var(--mut)',
  'In review': 'var(--sev-med)',
  Reviewed: 'var(--chart-accent)',
  Signed: 'var(--sev-low)',
};

/**
 * Страница проекта (дела): договоры одного клиента/спора. Список — в стиле
 * «Документов» (те же классы таблицы/карточек); строка кликабельна так же.
 * «Новый договор» уводит на страницу анализа, а готовый документ автоматически
 * попадает в это дело (одноразовый ключ PENDING_PROJECT_KEY, см. useChatStore).
 */
export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 700px)');
  const pushToast = useUIStore((s) => s.pushToast);

  // Отдельного GET /projects/:id нет — имя и счётчик берём из общего списка
  // (он закэширован useAsync и на повторных заходах рендерится мгновенно).
  const projects = useAsync((signal) => projectsApi.list(signal), []);
  const project = (projects.data ?? []).find((p) => p.id === id) ?? null;
  usePageTitle(project?.name ?? t('projects.title'));

  const docs = useAsync((signal) => documentsApi.list({ project: id }, signal), [id]);

  const timeAgo = (iso: string): string => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return t('docs.today');
    if (days === 1) return t('docs.yesterday');
    return t('docs.daysAgo', { n: days });
  };

  // ── Переименование ────────────────────────────────────────────────────────
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const openRename = () => {
    if (!project) return;
    setName(project.name);
    setRenameError(null);
    setRenameOpen(true);
  };

  const submitRename = async () => {
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setRenameError(t('projects.needName'));
      return;
    }
    setRenameBusy(true);
    try {
      const updated = await projectsApi.rename(project.id, trimmed);
      projects.mutate((rows) => (rows ?? []).map((r) => (r.id === updated.id ? updated : r)));
      pushToast(t('projects.renamedToast'), 'success');
      setRenameOpen(false);
      projects.reload();
    } catch (err) {
      setRenameError(err instanceof Error && err.message ? err.message : t('common.error'));
    } finally {
      setRenameBusy(false);
    }
  };

  // ── «Новый договор»: анализ на главной, документ авто-попадёт в это дело ──
  const startNewContract = () => {
    setPendingProject(id); // следующий стартованный анализ подошьётся в это дело
    useChatStore.getState().reset();
    navigate('/chat');
  };

  // ── «Добавить существующий» ───────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  // Свободные документы (вне проектов) грузятся при открытии модалки.
  const unassigned = useAsync(
    (signal) => (addOpen ? documentsApi.list({ project: 'none' }, signal) : Promise.resolve([] as ContractDocument[])),
    [addOpen],
  );
  const addCandidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    // Чужие (расшаренные командой) документы двигать нельзя — PATCH владельца.
    const own = (unassigned.data ?? []).filter((d) => !d.sharedBy);
    return q ? own.filter((d) => d.name.toLowerCase().includes(q)) : own;
  }, [unassigned.data, addSearch]);

  const addExisting = async (doc: ContractDocument) => {
    if (addingId) return;
    setAddingId(doc.id);
    try {
      const updated = await documentsApi.assignProject(doc.id, id);
      docs.mutate((rows) => [updated, ...(rows ?? []).filter((r) => r.id !== updated.id)]);
      unassigned.mutate((rows) => (rows ?? []).filter((r) => r.id !== doc.id));
      pushToast(t('projects.addedToast'), 'success');
      projects.reload(); // счётчик на карточке проекта
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setAddingId(null);
    }
  };

  // ── «Убрать из проекта» ───────────────────────────────────────────────────
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeFromProject = async (doc: ContractDocument) => {
    if (removingId) return;
    setRemovingId(doc.id);
    try {
      await documentsApi.assignProject(doc.id, null);
      docs.mutate((rows) => (rows ?? []).filter((r) => r.id !== doc.id));
      pushToast(t('projects.removedToast'), 'default');
      projects.reload();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setRemovingId(null);
    }
  };

  const rows = docs.data ?? [];
  const notFound = !projects.loading && !projects.error && project === null;

  const removeBtn = (d: ContractDocument) => (
    <IconButton
      icon="x"
      label={t('projects.removeFromProject')}
      title={t('projects.removeFromProject')}
      size="sm"
      iconSize={15}
      disabled={removingId === d.id}
      onClick={(e) => {
        e.stopPropagation();
        void removeFromProject(d);
      }}
    />
  );

  return (
    <div className={styles.page}>
      <TopBar title={project?.name ?? t('projects.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          {notFound ? (
            <EmptyState
              icon="folder"
              title={t('projects.notFound')}
              action={
                <Button variant="secondary" icon="back" onClick={() => navigate('/projects')}>
                  {t('projects.backToList')}
                </Button>
              }
            />
          ) : (
            <>
              <div
                className={styles.pageHead}
                ref={useReveal()}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h1 className={styles.pageTitle} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {project?.name ?? '…'}
                    </h1>
                    {project ? (
                      <IconButton icon="pen" label={t('projects.rename')} title={t('projects.rename')} size="sm" iconSize={15} onClick={openRename} />
                    ) : null}
                  </div>
                  <p className={styles.pageSub}>{t('projects.docsCount', { n: rows.length })}</p>
                </div>
                <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button variant="secondary" icon="docs" onClick={() => setAddOpen(true)}>
                    {t('projects.addExisting')}
                  </Button>
                  <Button variant="primary" icon="plus" onClick={startNewContract}>
                    {t('projects.newContract')}
                  </Button>
                </div>
              </div>

              {docs.loading ? (
                <SkeletonRows rows={4} height={48} />
              ) : docs.error ? (
                <ErrorState message={docs.error} onRetry={docs.reload} />
              ) : rows.length === 0 ? (
                <EmptyState icon="docs" title={t('projects.emptyDocs')} body={t('projects.emptyDocsBody')} />
              ) : isMobile ? (
                <div className={styles.rowCards}>
                  {rows.map((d) => (
                    <div key={d.id} className={styles.rowCard} onClick={() => navigate(`/documents/${d.id}`)}>
                      <div className={styles.rowCardHead}>
                        <div className={styles.docCellIcon}>
                          <Icon name="docs" size={16} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className={styles.docCellName}>{d.name}</div>
                          <div className={styles.docCellSub}>{d.counterparty}</div>
                        </div>
                        {removeBtn(d)}
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
              ) : (
                <div className={styles.tableCard}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>{t('docs.col.document')}</th>
                        <th className={`${styles.th} ${styles.hideSm}`}>{t('docs.col.status')}</th>
                        <th className={styles.th}>{t('docs.col.risk')}</th>
                        <th className={`${styles.th} ${styles.hideSm}`}>{t('docs.col.updated')}</th>
                        <th className={styles.th} aria-label={t('projects.removeFromProject')} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.id} className={styles.tr} onClick={() => navigate(`/documents/${d.id}`)}>
                          <td className={styles.td}>
                            <div className={styles.docCell}>
                              <div className={styles.docCellIcon}>
                                <Icon name="docs" size={16} />
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div className={styles.docCellName}>{d.name}</div>
                                <div className={styles.docCellSub}>{d.counterparty}</div>
                              </div>
                            </div>
                          </td>
                          <td className={`${styles.td} ${styles.hideSm}`}>
                            <Badge color={STATUS_TONE[d.status]} plain>{t(`status.${d.status}`)}</Badge>
                          </td>
                          <td className={styles.td}>
                            <RiskBadge risk={d.risk} plain />
                          </td>
                          <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>{timeAgo(d.updatedAt)}</td>
                          <td className={styles.td} style={{ width: 44 }}>
                            {removeBtn(d)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Переименование дела */}
      <Modal
        open={renameOpen}
        title={t('projects.rename')}
        onClose={() => !renameBusy && setRenameOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)} disabled={renameBusy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="check" onClick={() => void submitRename()} disabled={renameBusy}>
              {renameBusy ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <TextField
            label={t('projects.name')}
            name="projectName"
            value={name}
            placeholder={t('projects.namePh')}
            maxLength={120}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename();
            }}
          />
          {renameError ? <p className={styles.modalError}>{renameError}</p> : null}
        </div>
      </Modal>

      {/* Добавить существующий договор (список вне проектов + поиск по имени) */}
      <Modal open={addOpen} title={t('projects.addTitle')} onClose={() => setAddOpen(false)} maxWidth={540}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <TextField
            name="projectAddSearch"
            value={addSearch}
            placeholder={t('projects.addSearchPh')}
            data-autofocus
            onChange={(e) => setAddSearch(e.target.value)}
          />
          {unassigned.loading ? (
            <SkeletonRows rows={4} height={40} />
          ) : unassigned.error ? (
            <ErrorState message={unassigned.error} onRetry={unassigned.reload} />
          ) : addCandidates.length === 0 ? (
            <p className={styles.pageSub} style={{ margin: '6px 0' }}>
              {addSearch.trim() ? t('projects.addNoMatch') : t('projects.addEmpty')}
            </p>
          ) : (
            <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {addCandidates.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.projPickRow}
                  disabled={addingId !== null}
                  onClick={() => void addExisting(d)}
                >
                  <Icon name="docs" size={16} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span className={styles.projPickMeta}>
                    {addingId === d.id ? t('common.loading') : timeAgo(d.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
