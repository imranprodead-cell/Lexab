import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
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
  return (
    <div className={styles.state}>
      <div className={styles.stateIcon} style={{ color: 'var(--danger)' }}>
        <Icon name="alert" size={24} />
      </div>
      <div className={styles.stateTitle}>Something went wrong</div>
      <p className={styles.stateBody}>{message}</p>
      {onRetry ? (
        <Button variant="secondary" icon="history" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Full-panel loading state. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.state}>
      <Spinner size={26} />
      <div className={styles.stateBody} style={{ marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}
