import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import { useUIStore, type Theme } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { LANGUAGES } from '@/i18n/messages';
import { FeedbackModal } from './FeedbackModal';
import styles from './layout.module.css';

const THEME_OPTIONS: { value: Theme; icon: 'sun' | 'moon' | 'contrast'; labelKey: string }[] = [
  { value: 'light', icon: 'sun', labelKey: 'settings.theme.light' },
  { value: 'dark', icon: 'moon', labelKey: 'settings.theme.dark' },
  { value: 'system', icon: 'contrast', labelKey: 'settings.theme.standard' },
];

/**
 * Top-bar settings dropdown (gear next to the country flag): theme row
 * (light / dark / standard), interface language, feedback form, plans link.
 */
export function SettingsMenu() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setLangOpen(false);
  };
  const ref = useDismissable<HTMLDivElement>(close, open);

  // Menus opened from the keyboard should be keyboard-usable: focus the
  // selected theme (or the first control) as soon as the dropdown appears.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const active = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
      (active ?? menuRef.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    });
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      close();
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className={styles.settings} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.themeToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('top.settings')}
        title={t('top.settings')}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="settings" size={18} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          className={styles.settingsMenu}
          role="menu"
          aria-label={t('top.settings')}
          onKeyDown={onMenuKey}
        >
          <div className={styles.settingsThemes} role="group" aria-label={t('settings.themeGroup')}>
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === o.value}
                className={`${styles.settingsThemeBtn} ${theme === o.value ? styles.settingsThemeBtnOn : ''}`}
                aria-label={t(o.labelKey)}
                title={t(o.labelKey)}
                onClick={() => setTheme(o.value)}
              >
                <Icon name={o.icon} size={17} />
              </button>
            ))}
          </div>

          <div className={styles.settingsDivider} />

          <button
            type="button"
            role="menuitem"
            className={styles.settingsItem}
            aria-expanded={langOpen}
            onClick={() => setLangOpen((v) => !v)}
          >
            <Icon name="translate" size={16} />
            <span className={styles.settingsItemLabel}>{t('settings.language')}</span>
            <span className={styles.settingsItemHint}>{lang.toUpperCase()}</span>
            <span className={`${styles.settingsChevron} ${langOpen ? styles.settingsChevronOpen : ''}`}>
              <Icon name="chevron" size={14} strokeWidth={2} />
            </span>
          </button>

          {langOpen
            ? LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={lang === l.code}
                  className={`${styles.settingsSubItem} ${lang === l.code ? styles.settingsSubItemOn : ''}`}
                  onClick={() => setLang(l.code)}
                >
                  <span className={styles.settingsSubShort}>{l.short}</span>
                  <span className={styles.settingsItemLabel}>{l.label}</span>
                  {lang === l.code ? <Icon name="check" size={14} color="var(--accent)" strokeWidth={2.4} /> : null}
                </button>
              ))
            : null}

          <button
            type="button"
            role="menuitem"
            className={styles.settingsItem}
            onClick={() => {
              close();
              setFbOpen(true);
            }}
          >
            <Icon name="flag" size={16} />
            <span className={styles.settingsItemLabel}>{t('settings.feedback')}</span>
          </button>

          <div className={styles.settingsDivider} />

          <button
            type="button"
            role="menuitem"
            className={`${styles.settingsItem} ${styles.settingsItemAccent}`}
            onClick={() => {
              close();
              navigate('/plans');
            }}
          >
            <Icon name="diamond" size={16} />
            <span className={styles.settingsItemLabel}>{t('settings.plans')}</span>
          </button>
        </div>
      ) : null}

      <FeedbackModal open={fbOpen} onClose={() => setFbOpen(false)} />
    </div>
  );
}
