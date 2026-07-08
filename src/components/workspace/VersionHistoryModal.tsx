import { Modal } from '@/components/ui/Modal';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { versionsApi } from '@/api';
import styles from './workspace.module.css';

interface VersionHistoryModalProps {
  open: boolean;
  documentId: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Read-only version timeline for the active document. */
export function VersionHistoryModal({ open, documentId, onClose }: VersionHistoryModalProps) {
  const { data, loading, error, reload } = useAsync(
    (signal) => versionsApi.list(documentId, signal),
    [documentId, open],
  );

  return (
    <Modal open={open} title="Version history" onClose={onClose}>
      {loading ? (
        <LoadingState label="Loading versions…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div>
          {data?.map((v) => (
            <div key={v.id} className={styles.versionRow}>
              <span className={styles.versionDot} />
              <div>
                <div className={styles.versionLabel}>{v.label}</div>
                <div className={styles.versionMeta}>
                  {v.author} · {formatDate(v.createdAt)}
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
