import type { ReactNode } from 'react';
import { TopBarActions } from './TopBarActions';
import styles from './layout.module.css';

interface TopBarProps {
  /** A plain string is styled as the page title; a node (e.g. the brand menu) renders as-is. */
  title: ReactNode;
  /** Right-hand slot; defaults to the upgrade / theme / jurisdiction cluster. */
  right?: ReactNode;
  left?: ReactNode;
}

export function TopBar({ title, right, left }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {left}
        {typeof title === 'string' ? <span className={styles.topTitle}>{title}</span> : title}
      </div>
      {right ?? <TopBarActions />}
    </header>
  );
}
