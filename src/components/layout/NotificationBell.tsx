import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useDismissable } from '@/hooks/useAsync';
import { useNotificationsStore } from '@/store/useNotificationsStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './layout.module.css';

/** Notification bell + dropdown feed (mock events). */
export function NotificationBell() {
  const { t } = useI18n();
  const items = useNotificationsStore((s) => s.items);
  const unread = useNotificationsStore((s) => s.unread());
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const markRead = useNotificationsStore((s) => s.markRead);
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(() => setOpen(false), open);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className={styles.bell}
        aria-label={t('top.notifications')}
        title={t('top.notifications')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 ? <span className={styles.bellDot}>{unread}</span> : null}
      </button>

      {open ? (
        <GlassCard className={styles.notifMenu}>
          <div className={styles.notifHead}>
            <span className={styles.notifTitle}>{t('top.notifications')}</span>
            {unread > 0 ? (
              <button className={styles.notifMarkAll} onClick={markAllRead}>
                {t('top.markAllRead')}
              </button>
            ) : null}
          </div>
          <div className={`${styles.notifList} scroll`}>
            {items.length === 0 ? (
              <div className={styles.notifEmpty}>{t('top.noNotifications')}</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className={styles.notifItem} onClick={() => markRead(n.id)}>
                  <span className={styles.notifIcon}>
                    <Icon name={n.icon} size={16} />
                  </span>
                  <div className={styles.notifText}>
                    <div className={styles.notifItemTitle}>{n.title}</div>
                    <div className={styles.notifTime}>{n.time}</div>
                  </div>
                  {!n.read ? <span className={styles.notifUnreadDot} /> : null}
                </div>
              ))
            )}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
