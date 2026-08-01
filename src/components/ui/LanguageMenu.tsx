import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { LANGUAGES } from '@/i18n/messages';
import styles from './languageMenu.module.css';

/**
 * Language switcher: a translate-glyph button that opens a small dropdown
 * with the available interface languages. Shared between the public landing
 * page and the in-app top bar so both use the same control.
 */
export function LanguageMenu({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${className ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('lang.switch')}
        title={t('lang.switch')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="translate" size={17} />
        {showLabel ? (
          <span className={styles.triggerLabel}>
            {LANGUAGES.find((l) => l.code === lang)?.short ?? lang.toUpperCase()}
          </span>
        ) : null}
      </button>

      {/* Эталон LanguageSwitcher.tsx: AnimatePresence, scale .96 / y -4,
          0.18s easeOut. */}
      <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={styles.menu}
          role="menu"
          aria-label={t('lang.switch')}
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l.code}
              className={`${styles.item} ${lang === l.code ? styles.itemActive : ''}`}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
            >
              <span className={styles.itemShort}>{l.short}</span>
              <span className={styles.itemLabel}>{l.label}</span>
              {lang === l.code ? <Icon name="check" size={14} className={styles.itemCheck} /> : null}
            </button>
          ))}
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  );
}
