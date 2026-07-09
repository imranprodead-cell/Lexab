import { Icon, type IconName } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

interface FloatingToolbarProps {
  /** Team viewer: hide editing controls, keep downloads/history. */
  readOnly?: boolean;
  pendingCount: number;
  onAcceptAll: () => void;
  onDownload: () => void;
  onReport: () => void;
  onSendForSignature: () => void;
  onVersionHistory: () => void;
}

/** Persistent action bar floating over the document viewer. */
export function FloatingToolbar({
  readOnly = false,
  pendingCount,
  onAcceptAll,
  onDownload,
  onReport,
  onSendForSignature,
  onVersionHistory,
}: FloatingToolbarProps) {
  const { t } = useI18n();
  const action = (icon: IconName, label: string, onClick: () => void) => (
    <button className={styles.toolbarBtn} onClick={onClick}>
      <Icon name={icon} size={16} strokeWidth={1.9} />
      {label}
    </button>
  );

  return (
    <div className={styles.toolbar}>
      <GlassCard className={styles.toolbarInner}>
        {pendingCount > 0 && !readOnly ? (
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
            {t('ws.acceptAll', { n: pendingCount })}
          </button>
        ) : (
          <Badge color="Low">{readOnly ? t('ws.readOnlyBadge') : t('ws.reviewedBadge')}</Badge>
        )}
        <span className={styles.toolbarDivider} />
        {action('download', t('ws.downloadDocx'), onDownload)}
        {action('docs', t('ws.report'), onReport)}
        {!readOnly ? action('esign', t('ws.sendSign'), onSendForSignature) : null}
        {action('history', t('ws.versionsTitle'), onVersionHistory)}
      </GlassCard>
    </div>
  );
}
