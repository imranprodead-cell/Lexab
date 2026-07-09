import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { CountrySelector } from './CountrySelector';
import { NotificationBell } from './NotificationBell';
import styles from './layout.module.css';

/**
 * Right-hand top-bar cluster: upgrade CTA, notifications, light/dark toggle,
 * jurisdiction. Used as the default `right` slot of every TopBar.
 */
export function TopBarActions() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className={styles.topActions}>
      <button className={styles.upgrade} onClick={() => navigate('/plans')}>
        <span className={styles.upgradeMark}>
          <Icon name="diamond" size={13} color="var(--on-accent)" strokeWidth={2.2} />
        </span>
        {t('top.upgrade')}
      </button>

      <NotificationBell />

      <div className={styles.langSwitch} role="group" aria-label="Language">
        {(['ru', 'en'] as const).map((code) => (
          <button
            key={code}
            type="button"
            className={`${styles.langSwitchBtn} ${lang === code ? styles.langSwitchBtnActive : ''}`}
            aria-pressed={lang === code}
            onClick={() => setLang(code)}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>

      <button
        className={styles.themeToggle}
        onClick={toggleTheme}
        aria-label={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
        title={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
      >
        <Icon name={dark ? 'moon' : 'sun'} size={18} />
      </button>

      <CountrySelector />
    </div>
  );
}
