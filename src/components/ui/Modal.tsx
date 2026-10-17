import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ui.module.css';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

/**
 * Открытые модалки снизу вверх. Клик мимо окна и Esc закрывают только верхнюю:
 * иначе окно подтверждения, открытое поверх другого окна, на нажатии своей же
 * кнопки закрывало нижнее — и действие уходило в пустоту (так «умерла» кнопка
 * «Подтвердить» выдачи тарифа в админке).
 */
const openModals: object[] = [];
/** Событие, уже закрывшее верхнюю модалку, не закрывает следующую под ней:
 *  порядок слушателей на document не гарантирован. */
const consumed = new WeakSet<Event>();

/** Accessible modal dialog rendered in a portal. Closes on Esc / backdrop. */
export function Modal({ open, title, onClose, children, footer, maxWidth = 460 }: ModalProps) {
  const [token] = useState(() => ({}));
  const dismissIfTop = useCallback(
    (e: Event) => {
      if (consumed.has(e) || openModals[openModals.length - 1] !== token) return;
      consumed.add(e);
      onClose();
    },
    [onClose, token],
  );
  const ref = useDismissable<HTMLDivElement>(dismissIfTop, open);
  const { t } = useI18n();

  // Ловушка фокуса (WCAG): Tab циклится внутри диалога, а не уходит на
  // страницу под ним — базовое требование корпоративных a11y-опросников.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = ref.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!open) return;
    openModals.push(token);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move keyboard focus into the dialog (remember where it came from),
    // so Tab lands on the dialog's controls instead of the page behind it.
    // Prefer an explicit [data-autofocus] field (native autoFocus is defeated
    // by this rAF), falling back to the dialog wrapper.
    const opener = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]');
      (target ?? ref.current)?.focus();
    });
    return () => {
      const i = openModals.indexOf(token);
      if (i !== -1) openModals.splice(i, 1);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        style={{ maxWidth, outline: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={trapTab}
      >
        <header className={styles.modalHeader}>
          <span className={styles.modalTitle}>{title}</span>
          <button className={styles.modalClose} onClick={onClose} aria-label={t('a11y.closeDialog')}>
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
