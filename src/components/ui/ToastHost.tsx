import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { useUIStore } from '@/store/useUIStore';
import styles from './ui.module.css';

const TONE_COLOR = {
  default: 'var(--accent)',
  success: 'var(--ok)',
  error: 'var(--danger)',
} as const;

/** Global toast stack. Mounted once in AppShell; fed by useUIStore.pushToast. */
export function ToastHost() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className={styles.toastStack} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} role="status" onClick={() => dismiss(t.id)}>
          <span className={styles.toastDot} style={{ background: TONE_COLOR[t.tone] }} />
          <span style={{ flex: 1 }}>{t.message}</span>
          <Icon name="x" size={14} color="var(--mut)" />
        </div>
      ))}
    </div>,
    document.body,
  );
}
