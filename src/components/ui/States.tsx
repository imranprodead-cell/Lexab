import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { tStandalone } from '@/i18n/messages';
import { Button } from './Button';
import { Spinner } from './Spinner';
import styles from './ui.module.css';

/** Centered empty state with icon, title, body, and optional action. */
export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.state}>
      <div className={styles.stateIcon}>
        <Icon name={icon} size={24} />
      </div>
      <div className={styles.stateTitle}>{title}</div>
      {body ? <p className={styles.stateBody}>{body}</p> : null}
      {action}
    </div>
  );
}

/** Error state with a retry action. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.state}>
      <div className={styles.stateIcon} style={{ color: 'var(--danger)' }}>
        <Icon name="alert" size={24} />
      </div>
      <div className={styles.stateTitle}>{t('error.title')}</div>
      <p className={styles.stateBody}>{message}</p>
      {onRetry ? (
        <Button variant="secondary" icon="history" onClick={onRetry}>
          {t('error.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Full-panel loading state. */
export function LoadingState({ label = tStandalone('common.loading') }: { label?: string }) {
  return (
    <div className={styles.state}>
      <Spinner size={26} />
      <div className={styles.stateBody} style={{ marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

/** Single shimmering placeholder block. */
export function Skeleton({
  height = 16,
  width = '100%',
  radius = 8,
  style,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className={styles.skeletonBox} style={{ height, width, borderRadius: radius, ...style }} />;
}

/** Column of shimmering rows — the app-wide loading placeholder. */
export function SkeletonRows({
  rows = 5,
  height = 44,
  gap = 10,
}: {
  rows?: number;
  height?: number;
  gap?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, padding: '8px 0' }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} width={`${72 + ((i * 9) % 28)}%`} />
      ))}
    </div>
  );
}
