import { Icon } from '@/components/icons/Icon';
import type { Redline } from '@/types/domain';
import { useChatStore } from '@/store/useChatStore';
import styles from './workspace.module.css';

/** A single inline tracked change: pending (with accept/reject), accepted, or rejected. */
export function RedlineSpan({ redline }: { redline: Redline }) {
  const setStatus = useChatStore((s) => s.setRedlineStatus);
  const canEdit = useChatStore((s) => s.analysis?.canEdit !== false);

  if (redline.status === 'accepted') {
    return <span className={styles.redlineAccepted}>{redline.insText}</span>;
  }
  if (redline.status === 'rejected') {
    return <span>{redline.delText}</span>;
  }

  if (!canEdit) {
    // Read-only team member: show the tracked change without action buttons.
    return (
      <span className={styles.redlinePending}>
        <span className={styles.redlineDel}>{redline.delText}</span>
        <span className={styles.redlineIns}> {redline.insText}</span>
      </span>
    );
  }

  return (
    <span className={styles.redlinePending}>
      <span className={styles.redlineDel}>{redline.delText}</span>
      <span className={styles.redlineIns}> {redline.insText}</span>
      <span className={styles.redlineControls}>
        <button
          className={`${styles.redlineBtn} ${styles.redlineAcceptBtn}`}
          title="Accept change"
          aria-label={`Accept change: ${redline.insText}`}
          onClick={() => setStatus(redline.id, 'accepted')}
        >
          <Icon name="check" size={13} strokeWidth={2.4} />
        </button>
        <button
          className={`${styles.redlineBtn} ${styles.redlineRejectBtn}`}
          title="Reject change"
          aria-label={`Reject change: keep ${redline.delText}`}
          onClick={() => setStatus(redline.id, 'rejected')}
        >
          <Icon name="x" size={13} strokeWidth={2.4} />
        </button>
      </span>
    </span>
  );
}
