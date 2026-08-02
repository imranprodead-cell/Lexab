import { useState } from 'react';
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
  onDownload: (mode: 'tracked' | 'clean') => void;
  onReport: () => void;
  onSendForSignature: () => void;
  onVersionHistory: () => void;
  /** Публичная ссылка на отчёт для контрагента (скрыто у read-only зрителей). */
  onShare?: () => void;
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
  onShare,
}: FloatingToolbarProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
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
        {/* Download menu: tracked changes (default) vs clean final. */}
        <div className={styles.toolbarMenuWrap}>
          <button className={styles.toolbarBtn} onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <Icon name="download" size={16} strokeWidth={1.9} />
            {t('ws.download')}
          </button>
          {menuOpen ? (
            <>
              <button className={styles.menuBackdrop} aria-hidden onClick={() => setMenuOpen(false)} tabIndex={-1} />
              <div className={styles.toolbarMenu} role="menu">
                <button
                  className={styles.toolbarMenuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload('tracked');
                  }}
                >
                  <span className={styles.toolbarMenuTitle}>{t('ws.downloadTracked')}</span>
                  <span className={styles.toolbarMenuSub}>{t('ws.downloadTrackedHint')}</span>
                </button>
                <button
                  className={styles.toolbarMenuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload('clean');
                  }}
                >
                  <span className={styles.toolbarMenuTitle}>{t('ws.downloadClean')}</span>
                  <span className={styles.toolbarMenuSub}>{t('ws.downloadCleanHint')}</span>
                </button>
              </div>
            </>
          ) : null}
        </div>
        {action('docs', t('ws.report'), onReport)}
        {!readOnly && onShare ? action('share', t('ws.share'), onShare) : null}
        {!readOnly ? action('esign', t('ws.sendSign'), onSendForSignature) : null}
        {action('history', t('ws.versionsTitle'), onVersionHistory)}
      </GlassCard>
    </div>
  );
}
