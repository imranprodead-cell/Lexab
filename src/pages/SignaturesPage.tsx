import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { signaturesApi } from '@/api';
import type { SignatureStatus } from '@/types/domain';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

const STATUS_TONE: Record<SignatureStatus, string> = {
  Draft: 'var(--mut)',
  Sent: 'var(--sev-med)',
  Viewed: 'var(--accent)',
  Completed: 'var(--sev-low)',
  Declined: 'var(--sev-high)',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** E-signature request tracker. */
export function SignaturesPage() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const { data, loading, error, reload } = useAsync((signal) => signaturesApi.list(signal), []);
  const rows = data ?? [];

  return (
    <div className={styles.page}>
      <TopBar title={t('sig.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('sig.title')}</h1>
            <p className={styles.pageSub}>{t('sig.sub')}</p>
          </div>

          {loading ? (
            <LoadingState label={t('common.loading')} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <EmptyState icon="esign" title={t('sig.empty')} body={t('sig.emptyBody')} />
          ) : (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>{t('sig.col.document')}</th>
                    <th className={styles.th}>{t('sig.col.status')}</th>
                    <th className={`${styles.th} ${styles.hideSm}`}>{t('sig.col.recipients')}</th>
                    <th className={`${styles.th} ${styles.hideSm}`}>{t('sig.col.sent')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const signed = s.recipients.filter((r) => r.signed).length;
                    return (
                      <tr key={s.id} className={styles.tr} onClick={() => pushToast(`${s.documentName}…`)}>
                        <td className={styles.td}>
                          <div className={styles.docCell}>
                            <div className={styles.docCellIcon}>
                              <Icon name="esign" size={16} />
                            </div>
                            <div className={styles.docCellName}>{s.documentName}</div>
                          </div>
                        </td>
                        <td className={styles.td}>
                          <Badge color={STATUS_TONE[s.status]} plain>{s.status}</Badge>
                        </td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>
                          {t('sig.signed', { a: signed, b: s.recipients.length })}
                        </td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.mono}`}>{formatDate(s.sentAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
