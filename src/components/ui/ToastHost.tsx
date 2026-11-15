import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { useUIStore, type Toast } from '@/store/useUIStore';
import styles from './ui.module.css';

/** Значок тона: галочка — готово, «!» — ошибка, «i» — просто сообщение. */
function ToneIcon({ tone }: { tone: Toast['tone'] }) {
  if (tone === 'success') return <Icon name="check" size={13} strokeWidth={2.6} />;
  if (tone === 'error') return <Icon name="alert" size={13} strokeWidth={2.4} />;
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M12 11v6" />
      <path d="M12 7h.01" />
    </svg>
  );
}

/**
 * Global toast stack. Mounted once at the app root; fed by useUIStore.pushToast.
 * Графитовая плашка (2026-11-15, ui-test): значок тона, текст, действие,
 * крестик-кнопка и полоска оставшегося времени (на наведении — пауза).
 */
export function ToastHost() {
  const { t } = useI18n();
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);
  const hold = useUIStore((s) => s.holdToast);
  const release = useUIStore((s) => s.releaseToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className={styles.toastStack} aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${toast.leaving ? styles.toastLeaving : ''}`}
          data-tone={toast.tone}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => hold(toast.id)}
          onMouseLeave={() => release(toast.id)}
        >
          <span className={styles.toastIcon}>
            <ToneIcon tone={toast.tone} />
          </span>
          <span className={styles.toastMsg}>{toast.message}</span>
          {toast.actionLabel ? (
            <button
              type="button"
              className={styles.toastAction}
              onClick={() => {
                toast.onAction?.();
                dismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button type="button" className={styles.toastClose} onClick={() => dismiss(toast.id)} aria-label={t('common.close')} title={t('common.close')}>
            <Icon name="x" size={14} />
          </button>
          <span className={styles.toastBar} style={{ animationDuration: `${toast.duration}ms` }} aria-hidden="true" />
        </div>
      ))}
    </div>,
    document.body,
  );
}
