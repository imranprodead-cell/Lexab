import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import { EASE } from '@/lib/motion';
import { SideRail } from './SideRail';
import { CommandPalette } from './CommandPalette';
import { OnboardingModal } from './OnboardingModal';
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

  return (
    // Эталон ThemeProvider.tsx: все анимации приложения уважают системный
    // prefers-reduced-motion. Обёртка стоит здесь, а не в корне App.tsx:
    // в корне она затягивала библиотеку анимаций в первую загрузку публичных
    // страниц сайта, где анимаций нет вовсе.
    <MotionConfig reducedMotion="user">
    <div className={styles.shell}>
      {/* Скип-линк (WCAG): первый Tab даёт клавиатурным пользователям прыжок
          мимо навигации сразу к содержимому. Виден только при фокусе. */}
      <a href="#main-content" className={styles.skipLink}>
        {t('a11y.skipToContent')}
      </a>
      {isMobile ? (
        <button
          className={styles.mobileToggle}
          aria-label={t('a11y.menu')}
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          <Icon name="menuAlt" size={22} strokeWidth={2.2} />
        </button>
      ) : null}
      {isMobile && mobileNavOpen ? <div className={styles.scrim} onClick={() => setMobileNavOpen(false)} /> : null}
      <SideRail sessions={sessions} user={profile} onNewReview={onNewReview} />
      <div className={styles.main} id="main-content">
        {authUser && authUser.emailVerified === false ? (
          <div className={styles.verifyBanner} role="status">
            <span className={styles.verifyBannerText}>{t('verify.banner', { email: authUser.email })}</span>
            <button type="button" className={styles.verifyBannerBtn} onClick={resendVerify}>
              {t('verify.resend')}
            </button>
          </div>
        ) : null}
        {/* Переход между разделами — дословно эталонный AppShell:
            motion.div key={pathname}, opacity 0→1 + y 10→0, 0.35s EASE. */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className={styles.routeFade}
        >
          <Outlet />
        </motion.div>
      </div>
      <CommandPalette />
      <OnboardingModal />
    </div>
    </MotionConfig>
  );
}
