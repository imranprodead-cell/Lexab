import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { InitialsAvatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import { FeedbackModal } from './FeedbackModal';
import styles from './layout.module.css';

const MENU_WIDTH = 240;

interface UserMenuProps {
  user: { name: string; initials: string; avatarUrl?: string };
  plan?: string;
  /** Close the mobile drawer after navigating. */
  onNavigated: () => void;
}

/**
 * ChatGPT-style profile popup anchored to the user card at the bottom of the
 * side rail. Rendered in a portal: the rail clips its children
 * (overflow:hidden), and the Help flyout must overflow past the rail edge.
 */
export function UserMenu({ user, plan, onNavigated }: UserMenuProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeAll = () => {
    setOpen(false);
    setHelpOpen(false);
  };

  // The menu lives in a portal, so outside-click detection must consider both
  // the trigger and the portalled panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
          bottom: window.innerHeight - rect.top + 8,
        });
      }
    }
    setHelpOpen(false);
    setOpen((v) => !v);
  };

  const go = (to: string) => {
    closeAll();
    onNavigated();
    navigate(to);
  };

  const openLegal = (path: string) => {
    closeAll();
    // Public legal pages open in a new tab so the app state stays put.
    window.open(path, '_blank', 'noopener');
  };

  const onLogout = () => {
    closeAll();
    onNavigated();
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.user} ${styles.userBtn}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('umenu.open')}
        onClick={toggle}
      >
        <InitialsAvatar initials={user.initials} src={user.avatarUrl} />
        <div className={styles.userText}>
          <div className={styles.userName}>{user.name}</div>
          <div className={styles.userPlan}>
            <Icon name="diamond" size={11} color="var(--accent)" strokeWidth={2} />
            {plan ?? '…'}
          </div>
        </div>
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.userMenu}
              role="menu"
              style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: MENU_WIDTH }}
            >
              {/* Header: who is signed in — opens the profile in Settings. */}
              <button type="button" role="menuitem" className={styles.userMenuHead} onClick={() => go('/settings')}>
                <InitialsAvatar initials={user.initials} src={user.avatarUrl} />
                <div className={styles.userMenuHeadText}>
                  <div className={styles.userMenuHeadName}>{user.name}</div>
                  <div className={styles.userMenuHeadPlan}>{plan ?? '…'}</div>
                </div>
                <span className={styles.userMenuChevron}>
                  <Icon name="chevron" size={15} />
                </span>
              </button>

              <div className={styles.userMenuDivider} />

              <button type="button" role="menuitem" className={styles.userMenuItem} onClick={() => go('/plans')}>
                <Icon name="sparkle" size={16} />
                {t('umenu.changePlan')}
              </button>
              <button type="button" role="menuitem" className={styles.userMenuItem} onClick={() => go('/settings')}>
                <Icon name="settings" size={16} />
                {t('nav.settings')}
              </button>

              <div className={styles.userMenuDivider} />

              {/* Help flyout — opens on hover, overflows past the rail edge. */}
              <div
                className={styles.userMenuSubWrap}
                onMouseEnter={() => setHelpOpen(true)}
                onMouseLeave={() => setHelpOpen(false)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={helpOpen}
                  className={`${styles.userMenuItem} ${helpOpen ? styles.userMenuItemOpen : ''}`}
                  onClick={() => setHelpOpen((v) => !v)}
                >
                  <Icon name="help" size={16} />
                  {t('umenu.help')}
                  <span className={styles.userMenuChevron}>
                    <Icon name="chevron" size={15} />
                  </span>
                </button>

                {helpOpen ? (
                  <div className={styles.userMenuSub} role="menu">
                    <button type="button" role="menuitem" className={styles.userMenuItem} onClick={() => openLegal('/terms')}>
                      <Icon name="docs" size={16} />
                      {t('umenu.terms')}
                    </button>
                    <button type="button" role="menuitem" className={styles.userMenuItem} onClick={() => openLegal('/privacy')}>
                      <Icon name="shield" size={16} />
                      {t('umenu.privacy')}
                    </button>
                    <div className={styles.userMenuDivider} />
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.userMenuItem}
                      onClick={() => {
                        closeAll();
                        setFbOpen(true);
                      }}
                    >
                      <Icon name="alert" size={16} />
                      {t('umenu.reportBug')}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className={styles.userMenuDivider} />

              <button
                type="button"
                role="menuitem"
                className={`${styles.userMenuItem} ${styles.userMenuDanger}`}
                onClick={onLogout}
              >
                <Icon name="logout" size={16} strokeWidth={1.9} />
                {t('auth.signOut')}
              </button>
            </div>,
            document.body,
          )
        : null}

      <FeedbackModal open={fbOpen} onClose={() => setFbOpen(false)} />
    </>
  );
}
