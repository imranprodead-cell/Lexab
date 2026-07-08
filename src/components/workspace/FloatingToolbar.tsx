import { Icon, type IconName } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import styles from './workspace.module.css';

interface FloatingToolbarProps {
  pendingCount: number;
  onAcceptAll: () => void;
  onDownload: () => void;
  onReport: () => void;
  onSendForSignature: () => void;
  onVersionHistory: () => void;
}

/** Persistent action bar floating over the document viewer. */
export function FloatingToolbar({
  pendingCount,
  onAcceptAll,
  onDownload,
  onReport,
  onSendForSignature,
  onVersionHistory,
}: FloatingToolbarProps) {
  const action = (icon: IconName, label: string, onClick: () => void) => (
    <button className={styles.toolbarBtn} onClick={onClick}>
      <Icon name={icon} size={16} strokeWidth={1.9} />
      {label}
    </button>
  );

  return (
    <div className={styles.toolbar}>
      <GlassCard className={styles.toolbarInner}>
        {pendingCount > 0 ? (
          <button
            className={styles.toolbarBtn}
            onClick={onAcceptAll}
            style={{
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              border: 'none',
              fontWeight: 600,
            }}
          >
            <Icon name="check" size={16} color="var(--on-accent)" strokeWidth={1.9} />
            Accept all ({pendingCount})
          </button>
        ) : (
          <Badge color="Low">Reviewed</Badge>
        )}
        <span className={styles.toolbarDivider} />
        {action('download', 'Download DOCX', onDownload)}
        {action('docs', 'Report (PDF)', onReport)}
        {action('esign', 'Send for e-signature', onSendForSignature)}
        {action('history', 'Version history', onVersionHistory)}
      </GlassCard>
    </div>
  );
}
