import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useUxT } from '@/i18n/uxMessages';
import styles from './visuals.module.css';

/** «Копировать» карточки — её содержимое обычным текстом. */
export function CopyButton({ text }: { text: () => string }) {
  const u = useUxT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      className={styles.btn}
      title={u('vis.copy')}
      aria-label={u('vis.copy')}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text())
          .then(() => setDone(true))
          .catch(() => undefined);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      <span className={styles.btnText}>{done ? u('vis.copied') : u('vis.copy')}</span>
    </button>
  );
}
