import { Modal } from '@/components/ui/Modal';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { versionsApi } from '@/api';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

interface VersionHistoryModalProps {
  open: boolean;
  documentId: string;
  onClose: () => void;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Read-only version timeline for the active document. */
export function VersionHistoryModal({ open, documentId, onClose }: VersionHistoryModalProps) {
  const { t, lang } = useI18n();
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const { data, loading, error, reload } = useAsync(
    (signal) => versionsApi.list(documentId, signal),
    [documentId, open],
  );

  return (
    <Modal open={open} title={t('ws.versionsTitle')} onClose={onClose}>
      {loading ? (
        <SkeletonRows rows={3} height={44} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)' }}>{t('ws.noVersions')}</p>
      ) : (
        <div>
          {data.map((v) => (
            <div key={v.id} className={styles.versionRow}>
              <span className={styles.versionDot} />
              <div>
                <div className={styles.versionLabel}>{v.label}</div>
                <div className={styles.versionMeta}>
                  {v.author} · {formatDate(v.createdAt, locale)}
                </div>
                <div className={styles.versionNote}>{v.note}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
