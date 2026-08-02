import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { clearPendingProject, projectsApi } from '@/api';
import { useAsync, useDismissable } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { Reveal } from './Reveal';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { Project } from '@/types/domain';
import styles from './pages.module.css';

type ModalState =
  | { kind: 'create' }
  | { kind: 'rename'; project: Project }
  | { kind: 'delete'; project: Project }
  | null;

/**
 * Проекты (дела юристов): папки, внутри которых юрист ведёт договоры одного
 * клиента/спора. Доступно всем тарифам — базовая организация работы.
 */
export function ProjectsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('projects.title'));

  // Явный заход в раздел гасит незакрытый ключ «новый договор → в проект»:
  // иначе первый же следующий анализ молча утащил бы документ в старое дело.
  useEffect(() => {
    clearPendingProject();
  }, []);

  const { data, loading, error, reload, mutate } = useAsync((signal) => projectsApi.list(signal), []);

  // Меню «⋯» на карточке (одно открыто за раз).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useDismissable<HTMLDivElement>(() => setMenuFor(null), menuFor !== null);

  // Одна модалка на три режима: создать / переименовать / удалить.
  const [modal, setModal] = useState<ModalState>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setName('');
    setFormError(null);
    setModal({ kind: 'create' });
  };
  const openRename = (p: Project) => {
    setName(p.name);
    setFormError(null);
    setMenuFor(null);
    setModal({ kind: 'rename', project: p });
  };
  const openDelete = (p: Project) => {
    setMenuFor(null);
    setModal({ kind: 'delete', project: p });
  };
  const closeModal = () => {
    if (!busy) setModal(null);
  };

  const timeAgo = (iso: string): string => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return t('docs.today');
    if (days === 1) return t('docs.yesterday');
    return t('docs.daysAgo', { n: days });
  };

  const submit = async () => {
    if (!modal) return;
    if (modal.kind === 'delete') {
      setBusy(true);
      try {
        await projectsApi.remove(modal.project.id);
        const removedId = modal.project.id;
        // Документы дела сервер вернул в общий список — состав «Документов»
        // изменился; кэшированные списки пере-запросятся при следующем визите.
        mutate((rows) => (rows ?? []).filter((r) => r.id !== removedId));
        pushToast(t('projects.deletedToast'), 'default');
        setModal(null);
        reload();
      } catch (err) {
        pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError(t('projects.needName'));
      return;
    }
    setBusy(true);
    try {
      if (modal.kind === 'create') {
        const created = await projectsApi.create(trimmed);
        // Мгновенно показать созданное; reload() тихо сверит с сервером.
        mutate((rows) => [created, ...(rows ?? []).filter((r) => r.id !== created.id)]);
        pushToast(t('projects.createdToast'), 'success');
      } else {
        const updated = await projectsApi.rename(modal.project.id, trimmed);
        mutate((rows) => (rows ?? []).map((r) => (r.id === updated.id ? updated : r)));
        pushToast(t('projects.renamedToast'), 'success');
      }
      setModal(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error && err.message ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const rows = data ?? [];

  return (
    <div className={styles.page}>
      <TopBar title={t('projects.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div
            className={styles.pageHead}
            ref={useReveal()}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}
          >
            <div>
              <h1 className={styles.pageTitle}>{t('projects.title')}</h1>
              <p className={styles.pageSub}>{t('projects.sub')}</p>
            </div>
            {/* Кнопка в шапке — только при непустом списке: на пустом экране
                своя кнопка в центре. */}
            {!loading && !error && rows.length > 0 ? (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                {t('projects.new')}
              </Button>
            ) : null}
          </div>

          {loading ? (
            <SkeletonRows rows={3} height={110} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="folder"
              title={t('projects.empty')}
              body={t('projects.emptyBody')}
              action={
                <Button variant="primary" icon="plus" onClick={openCreate}>
                  {t('projects.new')}
                </Button>
              }
            />
          ) : (
            <div className={styles.grid}>
              {rows.map((p, i) => (
                <Reveal
                  key={p.id}
                  delay={Math.min(i, 6) * 0.08}
                  className={`${styles.card} ${styles.savedCard}`}
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <div className={styles.cardIcon}>
                    <Icon name="folder" size={20} />
                  </div>
                  <div className={styles.cardTitle}>{p.name}</div>
                  <div className={styles.cardFoot}>
                    <span>{t('projects.docsCount', { n: p.docsCount })}</span>
                    <span>{timeAgo(p.updatedAt)}</span>
                  </div>

                  <button
                    type="button"
                    className={styles.projMenuBtn}
                    aria-haspopup="menu"
                    aria-label={t('projects.cardMenu')}
                    title={t('projects.cardMenu')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === p.id ? null : p.id);
                    }}
                  >
                    <Icon name="dots" size={16} strokeWidth={2.4} />
                  </button>
                  {menuFor === p.id ? (
                    <div className={styles.projMenu} ref={menuRef} role="menu" onClick={(e) => e.stopPropagation()}>
                      <button type="button" role="menuitem" className={styles.projMenuItem} onClick={() => openRename(p)}>
                        <Icon name="pen" size={15} />
                        {t('projects.rename')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={`${styles.projMenuItem} ${styles.projMenuDanger}`}
                        onClick={() => openDelete(p)}
                      >
                        <Icon name="trash" size={15} />
                        {t('projects.delete')}
                      </button>
                    </div>
                  ) : null}
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={modal !== null}
        title={
          modal?.kind === 'rename'
            ? t('projects.rename')
            : modal?.kind === 'delete'
              ? t('projects.deleteTitle')
              : t('projects.new')
        }
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={busy}>
              {t('common.cancel')}
            </Button>
            {modal?.kind === 'delete' ? (
              <Button variant="primary" icon="trash" onClick={() => void submit()} disabled={busy}>
                {busy ? t('common.loading') : t('projects.delete')}
              </Button>
            ) : (
              <Button variant="primary" icon="check" onClick={() => void submit()} disabled={busy}>
                {busy ? t('common.loading') : modal?.kind === 'rename' ? t('common.save') : t('projects.create')}
              </Button>
            )}
          </>
        }
      >
        {modal?.kind === 'delete' ? (
          // Честный текст: договоры НЕ удаляются — вернутся в общий список.
          <p className={styles.pageSub} style={{ margin: 0 }}>
            {t('projects.deleteBody', { name: modal.project.name })}
          </p>
        ) : (
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
                if (e.key === 'Enter') void submit();
              }}
            />
            {formError ? <p className={styles.modalError}>{formError}</p> : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
