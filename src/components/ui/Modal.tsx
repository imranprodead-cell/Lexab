import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import styles from './ui.module.css';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

/** Accessible modal dialog rendered in a portal. Closes on Esc / backdrop. */
export function Modal({ open, title, onClose, children, footer, maxWidth = 460 }: ModalProps) {
  const ref = useDismissable<HTMLDivElement>(onClose, open);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <div className={styles.modal} style={{ maxWidth }} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className={styles.modalHeader}>
          <span className={styles.modalTitle}>{title}</span>
          <button className={styles.iconBtn} style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className={styles.modalBody}>{children}</div>
        {footer ? <footer className={styles.modalFooter}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
