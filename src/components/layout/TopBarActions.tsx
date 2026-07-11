import { CountrySelector } from './CountrySelector';
import { NotificationBell } from './NotificationBell';
import { SettingsMenu } from './SettingsMenu';
import styles from './layout.module.css';

/**
 * Right-hand top-bar cluster: notifications, settings menu (theme / language /
 * feedback / plans), jurisdiction. Used as the default `right` slot of every
 * TopBar. The plans CTA lives inside the settings menu.
 */
export function TopBarActions() {
  return (
    <div className={styles.topActions}>
      <NotificationBell />

      <SettingsMenu />

      <CountrySelector />
    </div>
  );
}
