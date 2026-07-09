import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Avatar, InitialsAvatar } from '@/components/ui/Avatar';
import { useAsync, useDismissable } from '@/hooks/useAsync';
import { billingApi } from '@/api/billing.api';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
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
  onLogout: () => void;
}

export function SideRail({ sessions, user, onNewReview, onLogout }: SideRailProps) {
  const open = useUIStore((s) => s.railPinned || s.railHovered);
  const setHovered = useUIStore((s) => s.setRailHovered);
  const pushToast = useUIStore((s) => s.pushToast);
  const { t, lang } = useI18n();

  const pinnedIds = useChatHistoryStore((s) => s.pinned);
  const togglePin = useChatHistoryStore((s) => s.togglePin);
  const renameSession = useChatHistoryStore((s) => s.renameSession);
  const archiveSession = useChatHistoryStore((s) => s.archiveSession);
  const deleteSession = useChatHistoryStore((s) => s.deleteSession);

  // Real plan from billing (not a hardcoded label).
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);

  // Collapse the rail after a navigation click (unless the user pinned it) —
  // the width transition plays the close animation.
  const collapse = () => setHovered(false);

  // Per-item "⋯" menu + inline rename state.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const menuRef = useDismissable<HTMLDivElement>(() => setMenuFor(null), menuFor !== null);

  const groups = useMemo(() => {
    const pinnedSet = new Set(pinnedIds);
    const pinned = sessions.filter((s) => pinnedSet.has(s.id));
    const rest = sessions.filter((s) => !pinnedSet.has(s.id));
    const dated = groupSessions(rest, {
      today: lang === 'ru' ? 'Сегодня' : 'Today',
      yesterday: lang === 'ru' ? 'Вчера' : 'Yesterday',
      prev: lang === 'ru' ? 'Последние 7 дней' : 'Previous 7 days',
    });
    return pinned.length ? [{ label: t('rail.pinnedGroup'), items: pinned }, ...dated] : dated;
  }, [sessions, pinnedIds, lang, t]);

  const commitRename = (id: string) => {
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
              else if (e.key === 'Escape') setRenamingId(null);
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
          aria-label="⋯"
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
                deleteSession(s.id); // shows the 5s undo toast itself
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
    <div className={styles.railSlot}>
      <nav
        className={`${styles.rail} ${open ? styles.railOpen : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label="Primary"
      >
        <div className={styles.brand}>
          <Avatar size={30} />
          <div className={styles.brandText}>
            <div className={styles.brandName}>LexAI</div>
            <div className={styles.brandSub}>{t('auth.tagline')}</div>
          </div>
        </div>

        <button
          className={styles.newBtn}
          onClick={() => {
            collapse();
            onNewReview();
          }}
        >
          <span className={styles.navIcon}>
            <Icon name="plus" size={19} />
          </span>
          <span className={styles.navLabel}>{t('nav.newReview')}</span>
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
                <Icon name={n.icon} size={19} />
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
              <Icon name="settings" size={19} />
            </span>
            <span className={styles.navLabel}>{t('nav.settings')}</span>
          </NavLink>

          <button
            className={`${styles.navItem} ${styles.signOut}`}
            onClick={() => {
              collapse();
              onLogout();
            }}
            type="button"
          >
            <span className={styles.navIcon}>
              <Icon name="logout" size={19} strokeWidth={1.9} />
            </span>
            <span className={styles.navLabel}>{t('auth.signOut')}</span>
          </button>

          <NavLink to="/settings" className={styles.user} onClick={collapse} aria-label={t('nav.settings')}>
            <InitialsAvatar initials={user.initials} src={user.avatarUrl} />
            <div className={styles.userText}>
              <div className={styles.userName}>{user.name}</div>
              <div className={styles.userPlan}>
                <Icon name="diamond" size={11} color="var(--accent)" strokeWidth={2} />
                {limits?.plan ?? '…'}
              </div>
            </div>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
