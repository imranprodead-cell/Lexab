import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/** Тикающие таймеры «удалить через 5 с» — МОДУЛЬНЫЕ, а не в стейте компонента:
 *  уход со страницы и возврат не должен ни воскрешать строку (таймер-то жив),
 *  ни давать «Восстановить» молча проиграть отложенному удалению. */
const pendingArchiveDeletes = new Map<string, ReturnType<typeof setTimeout>>();
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chatsApi } from '@/api/chats.api';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

/** Archived chats: restore them to the sidebar or delete them for good. */
export function ArchivePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const reloadSidebar = useChatHistoryStore((s) => s.load);
  const { data, loading, error, reload } = useAsync((signal) => chatsApi.list(true, signal), []);
  const isMobile = useMediaQuery('(max-width: 700px)');
  usePageTitle(t('archive.title'));

  // Rows hidden during their undo window — seeded from the module map, so a
  // remount keeps hiding rows whose delete timer is still ticking.
  const [pendingDelete, setPendingDelete] = useState<string[]>(() => [...pendingArchiveDeletes.keys()]);

  // A failed restore/delete must say so (like the other pages do) — a silently
  // swallowed error looks like the button simply didn't work.
  const restore = async (id: string) => {
    // «Восстановить» отменяет и отложенное удаление этого чата, если оно
    // тикает — иначе чат восстановился бы и молча исчез через пару секунд.
    const timer = pendingArchiveDeletes.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingArchiveDeletes.delete(id);
      setPendingDelete((ids) => ids.filter((x) => x !== id));
    }
    try {
      await chatsApi.update(id, { archived: false });
      reload();
      void reloadSidebar();
      pushToast(t('archive.restored'), 'success');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    }
  };

  // Deleting a chat for good is irreversible — hide the row and give a 5-second
  // undo window (toast with an "Undo" button) before actually removing it.
  const remove = (id: string) => {
    setPendingDelete((ids) => [...ids, id]);
    const finalize = () => {
      pendingArchiveDeletes.delete(id);
      chatsApi
        .remove(id)
        .then(() => reload())
        .catch((err) => {
          setPendingDelete((ids) => ids.filter((x) => x !== id)); // failed — bring the row back
          pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
        });
    };
    const timer = setTimeout(finalize, 5000);
    pendingArchiveDeletes.set(id, timer);
    pushToast(t('rail.deleting'), 'default', {
      duration: 5000,
      actionLabel: t('common.undo'),
      onAction: () => {
        clearTimeout(timer);
        pendingArchiveDeletes.delete(id);
        setPendingDelete((ids) => ids.filter((x) => x !== id));
        pushToast(t('rail.deleteCancelled'), 'success');
      },
    });
  };

  return (
    <div className={styles.page}>
      <TopBar title={t('archive.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('archive.title')}</h1>
            <p className={styles.pageSub}>{t('archive.sub')}</p>
          </div>

          {loading ? (
            <SkeletonRows rows={5} height={52} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data || data.length === 0 ? (
            <EmptyState icon="archive" title={t('archive.emptyTitle')} body={t('archive.emptyBody')} />
          ) : isMobile ? (
            /* Телефон: карточки вместо таблицы — три кнопки действий не
               заставляют скроллить строку вбок. */
            <div className={styles.rowCards}>
              {data.filter((s) => !pendingDelete.includes(s.id)).map((s) => (
                <div key={s.id} className={styles.rowCard} style={{ cursor: 'default' }}>
                  <div className={styles.rowCardHead}>
                    <Icon name="chat" size={17} color="var(--dim)" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className={styles.docCellName}>{s.title}</div>
                    </div>
                  </div>
                  <div className={styles.rowCardMeta}>
                    <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="sm" icon="chat" onClick={() => navigate(`/chat/${s.id}`)}>
                      {t('archive.open')}
                    </Button>
                    <Button size="sm" icon="upload" onClick={() => void restore(s.id)}>
                      {t('archive.restore')}
                    </Button>
                    <Button size="sm" icon="trash" onClick={() => void remove(s.id)}>
                      {t('rail.delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>{t('archive.colChat')}</th>
                    <th className={`${styles.th} ${styles.hideSm}`}>{t('docs.col.updated')}</th>
                    <th className={styles.th} style={{ width: 220 }} />
                  </tr>
                </thead>
                <tbody>
                  {data.filter((s) => !pendingDelete.includes(s.id)).map((s) => (
                    <tr key={s.id}>
                      <td className={styles.td}>
                        <div className={styles.docCell}>
                          <Icon name="chat" size={17} color="var(--dim)" />
                          <div className={styles.docCellName}>{s.title}</div>
                        </div>
                      </td>
                      <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>
                        {new Date(s.updatedAt).toLocaleDateString()}
                      </td>
                      <td className={styles.td}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <Button size="sm" icon="chat" onClick={() => navigate(`/chat/${s.id}`)}>
                            {t('archive.open')}
                          </Button>
                          <Button size="sm" icon="upload" onClick={() => void restore(s.id)}>
                            {t('archive.restore')}
                          </Button>
                          <Button size="sm" icon="trash" onClick={() => void remove(s.id)}>
                            {t('rail.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
