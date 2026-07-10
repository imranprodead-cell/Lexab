import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { LanguageMenu } from '@/components/ui/LanguageMenu';
import { useUIStore } from '@/store/useUIStore';
import { useResolvedDark } from '@/hooks/useResolvedDark';
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
  const { t } = useI18n();
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const dark = useResolvedDark();

  return (
    <div className={styles.topActions}>
      <button className={styles.upgrade} onClick={() => navigate('/plans')}>
        <span className={styles.upgradeMark}>
          <Icon name="diamond" size={13} color="var(--on-accent)" strokeWidth={2.2} />
        </span>
        {t('top.upgrade')}
      </button>

      <NotificationBell />

      <LanguageMenu />

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
