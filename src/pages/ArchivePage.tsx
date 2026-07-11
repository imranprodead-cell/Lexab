import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
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
  usePageTitle(t('archive.title'));

  const restore = async (id: string) => {
    await chatsApi.update(id, { archived: false });
    reload();
    void reloadSidebar();
    pushToast(t('archive.restored'), 'success');
  };

  const remove = async (id: string) => {
    await chatsApi.remove(id);
    reload();
    pushToast(t('rail.deletedToast'), 'default');
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
                  {data.map((s) => (
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
