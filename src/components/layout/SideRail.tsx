import { useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { UserMenu } from './UserMenu';
import { useAsync, useDismissable } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { billingApi } from '@/api/billing.api';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { ChatSession } from '@/types/domain';
import styles from './layout.module.css';

interface NavEntry {
  to: string;
  icon: IconName;
  key: string;
}

const NAV: NavEntry[] = [
  { to: '/chat', icon: 'chat', key: 'nav.chat' },
  { to: '/documents', icon: 'docs', key: 'nav.documents' },
  { to: '/templates', icon: 'layout', key: 'nav.templates' },
  { to: '/playbooks', icon: 'shield', key: 'nav.playbooks' },
  { to: '/contracts', icon: 'calendar', key: 'nav.contracts' },
  { to: '/batch', icon: 'inbox', key: 'nav.batch' },
  { to: '/signatures', icon: 'esign', key: 'nav.signatures' },
  { to: '/analytics', icon: 'analytics', key: 'nav.analytics' },
  { to: '/team', icon: 'users', key: 'nav.team' },
];

/** Group chat sessions into Today / Yesterday / Previous 7 days buckets. */
function groupSessions(sessions: ChatSession[], labels: { today: string; yesterday: string; prev: string }) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;

  const buckets: { label: string; items: ChatSession[] }[] = [
    { label: labels.today, items: [] },
    { label: labels.yesterday, items: [] },
    { label: labels.prev, items: [] },
  ];

  for (const s of sessions) {
    const diffDays = Math.floor((startOfToday.getTime() - new Date(s.updatedAt).setHours(0, 0, 0, 0)) / dayMs);
    if (diffDays <= 0) buckets[0].items.push(s);
    else if (diffDays === 1) buckets[1].items.push(s);
    else buckets[2].items.push(s);
  }
  return buckets.filter((b) => b.items.length > 0);
}

interface SideRailProps {
  sessions: ChatSession[];
  user: { name: string; firm: string; jurisdiction: string; initials: string; avatarUrl?: string };
  onNewReview: () => void;
}

export function SideRail({ sessions, user, onNewReview }: SideRailProps) {
  // Desktop: docked open/closed by a persistent toggle (ChatGPT-style), state
  // survives reloads. Phone: an ephemeral overlay drawer (separate state, so a
  // narrowed desktop window never inherits the docked-open state).
  const isMobile = useMediaQuery('(max-width: 700px)');
  const railPinned = useUIStore((s) => s.railPinned);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const toggleRail = useUIStore((s) => s.toggleRailPinned);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const pushToast = useUIStore((s) => s.pushToast);
  const { t } = useI18n();

  const open = isMobile ? mobileNavOpen : railPinned;
  const toggleOpen = () => (isMobile ? setMobileNavOpen(!open) : toggleRail());

  const navigate = useNavigate();
  const pinnedIds = useChatHistoryStore((s) => s.pinned);
  const togglePin = useChatHistoryStore((s) => s.togglePin);
  const renameSession = useChatHistoryStore((s) => s.renameSession);
  const archiveSession = useChatHistoryStore((s) => s.archiveSession);
  const deleteSession = useChatHistoryStore((s) => s.deleteSession);

  // Real plan from billing (not a hardcoded label).
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);

  // On phones the open rail is an overlay drawer — close it after navigating.
  // On desktop the docked rail stays open (like ChatGPT), so this is a no-op.
  const collapse = () => {
    if (isMobile) setMobileNavOpen(false);
  };

  // Per-item "⋯" menu + inline rename state.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Escape sets this just before it unmounts the input. The unmount fires a
  // blur, and that blur must NOT save the draft — Enter/blur save, Escape does not.
  const renameCancelled = useRef(false);
  const menuRef = useDismissable<HTMLDivElement>(() => setMenuFor(null), menuFor !== null);

  const groups = useMemo(() => {
    const pinnedSet = new Set(pinnedIds);
    const pinned = sessions.filter((s) => pinnedSet.has(s.id));
    const rest = sessions.filter((s) => !pinnedSet.has(s.id));
    const dated = groupSessions(rest, {
      today: t('rail.today'),
      yesterday: t('rail.yesterday'),
      prev: t('rail.prev7'),
    });
    return pinned.length ? [{ label: t('rail.pinnedGroup'), items: pinned }, ...dated] : dated;
  }, [sessions, pinnedIds, t]);

  const commitRename = (id: string) => {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      setRenamingId(null);
      return;
    }
    renameSession(id, draft);
    setRenamingId(null);
  };

  const renderRow = (s: ChatSession) => {
    const isPinned = pinnedIds.includes(s.id);
    return (
      <div key={s.id} className={styles.recentRow}>
        {renamingId === s.id ? (
          <input
            className={styles.recentRename}
            value={draft}
            autoFocus
            aria-label={t('rail.rename')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(s.id);
              else if (e.key === 'Escape') {
                renameCancelled.current = true;
                setRenamingId(null);
              }
            }}
            onBlur={() => commitRename(s.id)}
          />
        ) : (
          <NavLink to={`/chat/${s.id}`} className={styles.recentItem} title={s.title} onClick={collapse}>
            {s.title}
          </NavLink>
        )}

        <button
          type="button"
          className={`${styles.recentMore} ${menuFor === s.id ? styles.recentMoreOpen : ''}`}
          aria-label={t('rail.chatMenu')}
          title={t('rail.chatMenu')}
          aria-haspopup="menu"
          onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
        >
          <Icon name="dots" size={16} strokeWidth={2.4} />
        </button>

        {menuFor === s.id ? (
          <div className={styles.recentMenu} ref={menuRef} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.recentMenuItem}
              onClick={() => {
                togglePin(s.id);
                setMenuFor(null);
              }}
            >
              <Icon name="pin" size={15} />
              {t(isPinned ? 'rail.unpin' : 'rail.pin')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.recentMenuItem}
              onClick={() => {
                renameCancelled.current = false;
                setDraft(s.title);
                setRenamingId(s.id);
                setMenuFor(null);
              }}
            >
              <Icon name="pen" size={15} />
              {t('rail.rename')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.recentMenuItem}
              onClick={() => {
                archiveSession(s.id);
                setMenuFor(null);
                pushToast(t('rail.archivedToast'), 'default');
              }}
            >
              <Icon name="archive" size={15} />
              {t('rail.archive')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.recentMenuItem} ${styles.recentMenuDanger}`}
              onClick={() => {
                // Удаление ОТКРЫТОГО чата: сбрасываем канвас и уходим в новый
                // чат — иначе сообщения удалённой беседы висят на экране до
                // перезагрузки. Undo восстанавливает строку в списке (клик по
                // ней откроет беседу заново — сервер удаляет её лишь через 5с).
                const wasActive = useChatStore.getState().serverSessionId === s.id;
                deleteSession(s.id); // shows the 5s undo toast itself
                if (wasActive) {
                  useChatStore.getState().reset();
                  navigate('/chat');
                }
                setMenuFor(null);
              }}
            >
              <Icon name="trash" size={15} />
              {t('rail.delete')}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`${styles.railSlot} ${open ? styles.railSlotOpen : ''}`}>
      <nav id="app-sidebar" className={`${styles.rail} ${open ? styles.railOpen : ''}`} aria-label={t('a11y.primaryNav')}>
        <div className={styles.brand}>
          {open ? (
            <>
              <span className={styles.brandLogo}>
                <Avatar size={28} />
              </span>
              <button
                type="button"
                className={styles.collapseBtn}
                onClick={toggleOpen}
                aria-label={t('rail.collapse')}
                aria-expanded={true}
                aria-controls="app-sidebar"
                title={t('rail.collapse')}
              >
                <Icon name="sidebar" size={18} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.brandToggle}
              onClick={toggleOpen}
              aria-label={t('rail.expand')}
              aria-expanded={false}
              aria-controls="app-sidebar"
              title={t('rail.expand')}
            >
              <span className={styles.brandLogo}>
                <Avatar size={28} />
              </span>
              <span className={styles.brandToggleIcon}>
                <Icon name="sidebar" size={18} />
              </span>
            </button>
          )}
        </div>

        <button
          className={styles.newBtn}
          onClick={() => {
            collapse();
            onNewReview();
          }}
        >
          <span className={styles.navIcon}>
            <Icon name="compose" size={18} />
          </span>
          <span className={styles.navLabel}>{t('nav.newChat')}</span>
        </button>

        <div className={styles.navGroup}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              onClick={collapse}
            >
              <span className={styles.navIcon}>
                <Icon name={n.icon} size={18} />
              </span>
              <span className={styles.navLabel}>{t(n.key)}</span>
            </NavLink>
          ))}
        </div>

        {open ? (
          <div className={`${styles.recent} scroll`}>
            {groups.map((g) => (
              <div key={g.label} className={styles.recentGroup}>
                <div className={styles.recentLabel}>{g.label}</div>
                {g.items.map(renderRow)}
              </div>
            ))}
            <NavLink to="/archive" className={styles.archiveLink} onClick={collapse}>
              <Icon name="archive" size={14} />
              {t('archive.title')}
            </NavLink>
          </div>
        ) : (
          <div className={styles.railSpacer} />
        )}

        <div className={styles.railFooter}>
          <NavLink
            to="/settings"
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
            onClick={collapse}
          >
            <span className={styles.navIcon}>
              <Icon name="settings" size={18} />
            </span>
            <span className={styles.navLabel}>{t('nav.settings')}</span>
          </NavLink>

          <UserMenu user={user} plan={limits?.plan} onNavigated={collapse} />
        </div>
      </nav>
    </div>
  );
}
