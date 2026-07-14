import type { KeyboardEvent } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Redline } from '@/types/domain';
import { useChatStore } from '@/store/useChatStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

/** A single inline tracked change: pending (with accept/reject), accepted, or rejected. */
export function RedlineSpan({ redline }: { redline: Redline }) {
  const setStatus = useChatStore((s) => s.setRedlineStatus);
  const canEdit = useChatStore((s) => s.analysis?.canEdit !== false);
  const { t } = useI18n();

  // Decided redlines are clickable to revert to pending (undo) — but only for
  // editors. A read-only viewer sees the plain resolved text.
  const revertProps = canEdit
    ? {
        role: 'button' as const,
        tabIndex: 0,
        title: t('ws.revertRedline'),
        'aria-label': t('ws.revertRedline'),
        onClick: () => setStatus(redline.id, 'pending'),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setStatus(redline.id, 'pending');
          }
        },
      }
    : {};

  if (redline.status === 'accepted') {
    return (
      <span className={`${styles.redlineAccepted} ${canEdit ? styles.redlineRevertable : ''}`} {...revertProps}>
        {redline.insText}
      </span>
    );
  }
  if (redline.status === 'rejected') {
    // A rejected change reads as plain text; for editors a faint dotted
    // underline marks it so it can be found and reverted.
    return canEdit ? (
      <span className={`${styles.redlineRejected} ${styles.redlineRevertable}`} {...revertProps}>
        {redline.delText}
      </span>
    ) : (
      <span>{redline.delText}</span>
    );
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
