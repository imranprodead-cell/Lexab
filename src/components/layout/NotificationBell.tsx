import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useDismissable, clearAsyncCache } from '@/hooks/useAsync';
import { teamApi } from '@/api';
import { useNotificationsStore, type AppNotification } from '@/store/useNotificationsStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './layout.module.css';

/** Notification bell + dropdown feed of real server events. */
/** Relative time in the interface language (falls back to the server string). */
function relativeTime(iso: string | undefined, lang: string, fallback: string): string {
  if (!iso) return fallback;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return fallback;
  const diffMs = Date.now() - ms;
  const rtf = new Intl.RelativeTimeFormat(lang === 'ru' ? 'ru' : 'en', { numeric: 'auto' });
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

export function NotificationBell() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const items = useNotificationsStore((s) => s.items);
  const unread = useNotificationsStore((s) => s.unread());
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const markRead = useNotificationsStore((s) => s.markRead);
  const load = useNotificationsStore((s) => s.load);
  const refresh = useNotificationsStore((s) => s.refresh);
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  // Hydrate from the server and poll every minute for new events.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Closing the panel counts as "seen": everything is marked read, so the
  // red badge disappears until genuinely new notifications arrive.
  const close = () => {
    setOpen(false);
    if (unread > 0) markAllRead();
  };
  const ref = useDismissable<HTMLDivElement>(close, open);

  /** «Принять» on a team invite — join right from the bell. */
  const acceptInvite = async (n: AppNotification) => {
    if (!n.actionData || accepting) return;
    setAccepting(n.id);
    try {
      await teamApi.acceptByToken(n.actionData);
      markRead(n.id);
      clearAsyncCache(); // the Team page must show the new membership
      pushToast(t('team.acceptedToast'), 'success');
      void refresh();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setAccepting(null);
    }
  };

  /** «Открыть» — navigate to the app page the event points at. */
  const openAction = (n: AppNotification) => {
    if (!n.actionData) return;
    markRead(n.id);
    close();
    navigate(n.actionData);
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className={styles.bell}
        aria-label={t('top.notifications')}
        title={t('top.notifications')}
        onClick={() => {
          if (open) {
            close();
          } else {
            void load();
            setOpen(true);
          }
        }}
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
                    <div className={styles.notifItemTitle}>
                      {lang !== 'ru' && n.titleEn ? n.titleEn : n.title}
                    </div>
                    {n.body ? (
                      <div className={styles.notifBody}>{lang !== 'ru' && n.bodyEn ? n.bodyEn : n.body}</div>
                    ) : null}
                    <div className={styles.notifTime}>{relativeTime(n.createdAt, lang, n.time)}</div>
                    {n.actionKind === 'team_invite' && n.actionData ? (
                      <div className={styles.notifActions}>
                        <button
                          type="button"
                          className={styles.notifActionPrimary}
                          disabled={accepting === n.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void acceptInvite(n);
                          }}
                        >
                          <Icon name="check" size={13} strokeWidth={2.4} />
                          {accepting === n.id ? t('common.loading') : t('team.accept')}
                        </button>
                        <button
                          type="button"
                          className={styles.notifActionGhost}
                          onClick={(e) => {
                            e.stopPropagation();
                            close();
                            navigate('/team');
                          }}
                        >
                          {t('top.notifOpen')}
                        </button>
                      </div>
                    ) : n.actionKind === 'open' && n.actionData ? (
                      <div className={styles.notifActions}>
                        <button
                          type="button"
                          className={styles.notifActionGhost}
                          onClick={(e) => {
                            e.stopPropagation();
                            openAction(n);
                          }}
                        >
                          {t('top.notifOpen')}
                          <Icon name="chevron" size={12} />
                        </button>
                      </div>
                    ) : null}
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
