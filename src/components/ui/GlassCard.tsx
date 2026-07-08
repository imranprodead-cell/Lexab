import type { CSSProperties, ReactNode } from 'react';
import styles from './ui.module.css';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Render as a button for clickable cards (keeps a11y semantics). */
  as?: 'div' | 'button';
  onClick?: () => void;
  type?: 'button';
}

/** Frosted-glass surface used for chat cards, popovers, and the toolbar. */
export function GlassCard({ children, className = '', style, as = 'div', onClick }: GlassCardProps) {
  const cls = `${styles.glass} ${className}`;
  if (as === 'button') {
    return (
      <button type="button" className={cls} style={style} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <div className={cls} style={style} onClick={onClick}>
      {children}
    </div>
  );
}
