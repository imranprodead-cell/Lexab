import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SideRail } from './SideRail';
import { CommandPalette } from './CommandPalette';
import { OnboardingModal } from './OnboardingModal';
import { ToastHost } from '@/components/ui/ToastHost';
import { authApi } from '@/api/auth.api';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useChatStore } from '@/store/useChatStore';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { Icon } from '@/components/icons/Icon';
import type { UserProfile } from '@/types/domain';
import styles from './layout.module.css';

/** Neutral placeholder shown in the rail while no user is signed in. */
const EMPTY_PROFILE: UserProfile = { name: '—', initials: '·', firm: '', jurisdiction: '', email: '' };

/**
 * Root layout: side rail + routed content. Loads the session list, wires global
 * shortcuts + network status, and hosts the toast stack and command palette.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  useKeyboardShortcuts();
  useNetworkStatus();

  const resetChat = useChatStore((s) => s.reset);
  const authUser = useAuthStore((s) => s.user);
  const pushToast = useUIStore((s) => s.pushToast);
  const { t } = useI18n();

  const resendVerify = () => {
    void authApi
      .resendVerify()
      .then(() => pushToast(t('verify.resent'), 'success'))
      .catch(() => pushToast(t('common.error'), 'error'));
  };
  const logout = useAuthStore((s) => s.logout);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const isMobile = useMediaQuery('(max-width: 700px)');
  const sessions = useChatHistoryStore((s) => s.sessions);
  const loadSessions = useChatHistoryStore((s) => s.load);
  const token = useAuthStore((s) => s.token);

  // Sidebar history comes from the server; refresh when the signed-in user changes.
  useEffect(() => {
    void loadSessions();
  }, [loadSessions, token]);

  const profile = authUser ?? EMPTY_PROFILE;

  const onNewReview = () => {
    resetChat();
    navigate('/chat');
  };

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={styles.shell}>
      {isMobile ? (
        <button
          className={styles.mobileToggle}
          aria-label="Menu"
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          <Icon name="menu" size={20} />
        </button>
      ) : null}
      {isMobile && mobileNavOpen ? <div className={styles.scrim} onClick={() => setMobileNavOpen(false)} /> : null}
      <SideRail sessions={sessions} user={profile} onNewReview={onNewReview} onLogout={onLogout} />
      <div className={styles.main}>
        {authUser && authUser.emailVerified === false ? (
          <div className={styles.verifyBanner} role="status">
            <span className={styles.verifyBannerText}>{t('verify.banner', { email: authUser.email })}</span>
            <button type="button" className={styles.verifyBannerBtn} onClick={resendVerify}>
              {t('verify.resend')}
            </button>
          </div>
        ) : null}
        <div key={location.pathname.split('/')[1] || 'root'} className={styles.routeFade}>
          <Outlet />
        </div>
      </div>
      <ToastHost />
      <CommandPalette />
      <OnboardingModal />
    </div>
  );
}
