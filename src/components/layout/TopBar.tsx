import type { ReactNode } from 'react';
import { TopBarActions } from './TopBarActions';
import styles from './layout.module.css';

interface TopBarProps {
  title: string;
  /** Right-hand slot; defaults to the upgrade / theme / jurisdiction cluster. */
  right?: ReactNode;
  left?: ReactNode;
}

export function TopBar({ title, right, left }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {left}
        <span className={styles.topTitle}>{title}</span>
      </div>
      {right ?? <TopBarActions />}
    </header>
  );
}
