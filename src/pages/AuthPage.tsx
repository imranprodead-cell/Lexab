import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { EASE } from '@/lib/motion';
import { Avatar } from '@/components/ui/Avatar';
import { Background } from '@/components/ui/Background';
import { CountUp } from '@/components/ui/CountUp';
import { ScalesMascot } from '@/components/ui/ScalesMascot';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { LanguageMenu } from '@/components/ui/LanguageMenu';
import { TextField } from '@/components/ui/TextField';
import { Icon } from '@/components/icons/Icon';
import { LandingSections } from '@/components/landing/LandingSections';
import { TelegramWidget } from '@/components/landing/TelegramWidget';
import { teamApi } from '@/api';
import { authApi } from '@/api/auth.api';
import { ApiError } from '@/api/util';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useResolvedDark } from '@/hooks/useResolvedDark';
import { useI18n } from '@/i18n/I18nProvider';
import { usePageTitle } from '@/hooks/usePageTitle';
import { scrollBehavior } from '@/lib/scroll';
import styles from './auth.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

/* Эталон AuthCard.tsx: амплитуда 3D-наклона карточки. */
const MAX_TILT = 2.5;

/** Обёртки, анимирующие высоту, режут фокусное кольцо инпутов по бокам
 *  (overflow: hidden проходит ровно по краю поля). Сдвигаем границу клипа
 *  на 6px наружу: кольцо (2px + отступ 2px) целиком помещается. */
const CLIP_STYLE: React.CSSProperties = { overflow: 'hidden', margin: '0 -6px', padding: '0 6px' };

type Mode = 'signin' | 'signup' | 'reset';

/** The official multicolour Google "G". */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Landing nav pill: section anchors rendered in the sticky top banner. */
const NAV_SECTIONS = [
  { id: 'features', key: 'landing.nav.features' },
  { id: 'solutions', key: 'landing.nav.solutions' },
  { id: 'security', key: 'landing.nav.security' },
  { id: 'plans', key: 'landing.nav.plans' },
  { id: 'faq', key: 'landing.nav.faq' },
] as const;

/** Sign-in / sign-up screen: Google OAuth + expandable email form. */
export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  // На «/» (лендинг) оставляем маркетинговый тайтл по умолчанию — он совпадает
  // с пререндером и не портит сниппет в поиске; «Вход» — только на /login.
  usePageTitle(location.pathname === '/' ? undefined : t('auth.signInTitle'));
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const status = useAuthStore((s) => s.status);
  /** True when the user was signed out by an expired/revoked token. */
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const pushToast = useUIStore((s) => s.pushToast);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const dark = useResolvedDark();

  const token = useAuthStore((s) => s.token);

  const [emailOpen, setEmailOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** After a `totp_required` challenge: the 2FA code input is revealed and the
   *  same email+password are re-submitted with the code. */
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  /** Reset-request goes straight to the API (not the store), so guard the
   *  in-flight request ourselves to keep the button from firing twice. */
  const [resetBusy, setResetBusy] = useState(false);
  /** Set after sign-up: the confirmation letter went to this address. */
  const [verifySentTo, setVerifySentTo] = useState<string | null>(null);
  /** Returning from Google with a one-time code: show the branded "signing in"
   *  screen instead of flashing the login form. */
  const [finishing, setFinishing] = useState(() => window.location.hash.startsWith('#code='));
  /** Fade the whole screen out before navigating into the app. */
  const [leaving, setLeaving] = useState(false);
  /** The page's own scroll container (#root is overflow:hidden). */
  const rootRef = useRef<HTMLDivElement>(null);
  /** Landing section currently in view — highlights its nav pill item. */
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /** Glass nav: after 16px of page scroll the bar tightens and gains a shadow. */
  const [scrolled, setScrolled] = useState(false);

  // Team invite link (/login?invite=<token>): show who invites and land on /team.
  const inviteToken = new URLSearchParams(location.search).get('invite');
  const [invite, setInvite] = useState<{ inviterName: string; inviterFirm: string; email: string; role: string } | null>(null);
  useEffect(() => {
    if (!inviteToken) return;
    // Новичок уходит с этой страницы в почту подтверждать адрес — приглашение
    // переживает этот крюк в localStorage, чтобы /verify-email привёл в /team,
    // а не бросил в пустой чат (приглашение тогда никто никогда не принимал).
    try {
      localStorage.setItem('lexai.pendingInvite', inviteToken);
    } catch {
      /* storage blocked — путь через колокольчик всё равно останется */
    }
    teamApi
      .inviteInfo(inviteToken)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [inviteToken]);

  const redirectTo = inviteToken ? '/team' : ((location.state as { from?: string } | null)?.from ?? '/chat');

  // The Google callback returns here with #code=<one-time code> (or #error=<code>).
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#code=')) {
      const code = decodeURIComponent(hash.slice('#code='.length));
      window.history.replaceState(null, '', window.location.pathname);
      authApi
        .exchangeGoogleCode(code)
        .then((session) => adoptSession(session.token, session.user))
        .catch(() => {
          setFinishing(false);
          pushToast(t('auth.googleFailed'), 'error');
        });
    } else if (hash.startsWith('#error=')) {
      const code = decodeURIComponent(hash.slice('#error='.length));
      window.history.replaceState(null, '', window.location.pathname);
      const msg =
        code === 'sso_required'
          ? t('auth.ssoRequired')
          : code === 'team_full'
            ? t('auth.ssoTeamFull')
            : code === 'domain_mismatch'
              ? t('auth.ssoDomainMismatch')
              : t('auth.googleFailed');
      pushToast(msg, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the Google session is adopted, glide into the app after a beat —
  // keyed on the store token so it survives StrictMode's double-mount.
  useEffect(() => {
    if (!finishing || !token) return;
    const timer = setTimeout(() => navigate(redirectTo, { replace: true }), 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishing, token]);

  /** Fade out, then run the actual transition (navigate / external redirect). */
  const departAnd = (action: () => void, delay = 320) => {
    setLeaving(true);
    setTimeout(action, delay);
  };

  const startGoogle = () => {
    // Keep the invite token through the OAuth round-trip.
    const back = encodeURIComponent(
      `${window.location.origin}/login${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`,
    );
    departAnd(() => {
      window.location.href = `${API_BASE}/auth/google?redirect=${back}`;
    }, 260);
  };

  // Corporate SSO: enter a work email → if the domain has SSO, go to the IdP.
  const [ssoOpen, setSsoOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('');
  const [ssoBusy, setSsoBusy] = useState(false);
  const startSso = async () => {
    const email = ssoEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      pushToast(t('auth.ssoBadEmail'), 'error');
      return;
    }
    setSsoBusy(true);
    try {
      const { available } = await authApi.ssoLookup(email);
      if (!available) {
        pushToast(t('auth.ssoNotConfigured'), 'error');
        return;
      }
      const back = encodeURIComponent(
        `${window.location.origin}/login${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`,
      );
      departAnd(() => {
        window.location.href = `${API_BASE}/auth/sso/start?email=${encodeURIComponent(email)}&redirect=${back}`;
      }, 260);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setSsoBusy(false);
    }
  };

  const title =
    mode === 'signin' ? t('auth.signInTitle') : mode === 'signup' ? t('auth.signUpTitle') : t('auth.resetTitle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('auth.errRequired'));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('auth.errEmail'));
      return;
    }

    if (mode === 'reset') {
      if (resetBusy) return;
      setError(null);
      setResetBusy(true);
      try {
        // «Существует ли адрес» сервер и так не раскрывает (всегда 204) —
        // здесь ловим только ТРАНСПОРТНЫЕ сбои (нет сети, лимит запросов,
        // 5xx). Показать «письмо отправлено» при реально не ушедшем запросе
        // нельзя: это единственный путь вернуть аккаунт.
        await authApi.requestReset(email.trim());
      } catch (err) {
        setResetBusy(false);
        setError(err instanceof Error && err.message ? err.message : t('common.error'));
        return;
      }
      setResetBusy(false);
      pushToast(t('auth.resetSent'), 'success');
      setMode('signin');
      return;
    }

    if ((mode === 'signup' && !name.trim()) || !password.trim()) {
      setError(t('auth.errRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.errPassword'));
      return;
    }
    // Once challenged, the code is required to complete the sign-in.
    if (mode === 'signin' && twoFactor && !code.trim()) {
      setError(t('sec.2fa.codeRequired'));
      return;
    }
    setError(null);
    try {
      if (mode === 'signin') {
        const factor = twoFactor
          ? useBackupCode
            ? { backupCode: code.trim() }
            : { code: code.trim() }
          : undefined;
        await login(email.trim(), password, factor);
        departAnd(() => navigate(redirectTo, { replace: true }));
        return;
      }
      const outcome = await register(name.trim(), email.trim(), password);
      if (outcome === 'signed-in') {
        departAnd(() => navigate(redirectTo, { replace: true }));
        return;
      }
      // Account created — the session starts from the emailed link.
      setVerifySentTo(email.trim());
      setPassword('');
      setMode('signin');
    } catch (err) {
      // 2FA-enabled account, first attempt without a code: reveal the code
      // input instead of showing an error, and let the user re-submit.
      if (mode === 'signin' && !twoFactor && err instanceof ApiError && err.code === 'totp_required') {
        setTwoFactor(true);
        setError(null);
        return;
      }
      // Already challenged and a 401 came back → the code was wrong (the retry
      // 401 may or may not carry the code); show it inline by the code input.
      if (mode === 'signin' && twoFactor && err instanceof ApiError && err.status === 401) {
        setError(t('sec.2fa.invalidCode'));
        return;
      }
      // Surface the real backend message ("Invalid email or password", …).
      setError(err instanceof Error && err.message ? err.message : t('common.error'));
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setVerifySentTo(null);
    // The challenge is bound to a specific sign-in attempt — drop it on switch.
    setTwoFactor(false);
    setCode('');
    setUseBackupCode(false);
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    // Deliberately NOT written into the URL: a stored `#features` would make
    // the next visit open mid-page instead of on the sign-in hero.
  };

  /** Landing CTAs: back to the top of the page with the sign-up form open. */
  const startSignup = () => {
    setEmailOpen(true);
    setMode('signup');
    setVerifySentTo(null);
    rootRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() });
  };

  // Opening the site always starts at the top — the sign-in hero — never
  // mid-page. A leftover section anchor (e.g. #features from an old link)
  // is stripped so the browser can't jump there; the user scrolls himself.
  // The Google OAuth return hash (#code=…) is left untouched.
  useEffect(() => {
    if (finishing) return;
    const id = window.location.hash.slice(1);
    if (id && NAV_SECTIONS.some((s) => s.id === id)) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    requestAnimationFrame(() => {
      rootRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Glass nav (эталон Navbar): scrollTop > 16 of the page's own scroll
  // container compresses the bar and switches it to the "scrolled" glass.
  useEffect(() => {
    if (finishing) return;
    const el = rootRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 16);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [finishing]);

  // Scrollspy: highlight the nav item of the section crossing mid-viewport.
  useEffect(() => {
    if (finishing || typeof IntersectionObserver === 'undefined') return;
    /* Помним видимость КАЖДОЙ секции: когда ни одна не в средней полосе
       вьюпорта (пользователь на hero) — подсветка гаснет, а не «залипает». */
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const current = NAV_SECTIONS.find((s) => visible.get(s.id));
        setActiveSection(current ? current.id : null);
      },
      { root: rootRef.current, rootMargin: '-35% 0px -55% 0px' },
    );
    const watched = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    watched.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [finishing]);

  // 3D-tilt карточки — скопировано дословно из эталона AuthCard.tsx
  // (useSpring stiffness 160 / damping 20, MAX_TILT 2.5, perspective 900).
  // Хуки подняты над ранним return (finishing) — порядок хуков стабилен.
  const cardRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rotateX = useSpring(useMotionValue(0), { stiffness: 160, damping: 20 });
  const rotateY = useSpring(useMotionValue(0), { stiffness: 160, damping: 20 });

  // Блик по стеклу (glare) движется за курсором вместе с наклоном карточки.
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(30);
  const glareOpacity = useSpring(useMotionValue(0), { stiffness: 200, damping: 30 });
  const glare = useMotionTemplate`radial-gradient(280px circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.16), transparent 70%)`;

  const onCardMouseMove = (e: React.MouseEvent) => {
    if (reduce || !cardRef.current) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const rect = cardRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(px * MAX_TILT * 2);
    rotateX.set(-py * MAX_TILT * 2);
    glareX.set((px + 0.5) * 100);
    glareY.set((py + 0.5) * 100);
    glareOpacity.set(1);
  };

  const onCardMouseLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
    glareOpacity.set(0);
  };

  // Магнитная «Начать бесплатно» в шапке: слегка тянется к курсору (±4px).
  const magX = useSpring(useMotionValue(0), { stiffness: 320, damping: 24 });
  const magY = useSpring(useMotionValue(0), { stiffness: 320, damping: 24 });
  const onCtaMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (reduce || !window.matchMedia('(pointer: fine)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    magX.set(Math.max(-4, Math.min(4, (e.clientX - (r.left + r.width / 2)) * 0.15)));
    magY.set(Math.max(-3, Math.min(3, (e.clientY - (r.top + r.height / 2)) * 0.25)));
  };
  const onCtaMouseLeave = () => {
    magX.set(0);
    magY.set(0);
  };

  /** Hero headline words: cascade delays 0.1 + i*0.1 (accent word last). */
  const heroWords = t('auth.heroLine1').split(' ');

  // Branded hand-off screen while the Google session settles in.
  if (finishing) {
    return (
      <div className={`${styles.auth} ${styles.finishScreen}`}>
        <div className={styles.finishInner}>
          <ScalesMascot size={116} />
          <div className={styles.finishText}>{t('auth.signingIn')}</div>
          <div className={styles.finishBar}>
            <div />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.auth} ${leaving ? styles.authLeaving : ''}`} ref={rootRef}>
      {/* Scenery of the эталон: travelling blooms, masked grid, sparkles,
          noise — parallaxed against this page's own scroll container. */}
      <Background scrollRef={rootRef} />

      {/* ── Fixed glass top bar (эталон Navbar): brand · nav links · controls.
             Появление y:-32 → 0 за 0.6s EASE — дословно из Navbar.tsx. ── */}
      <motion.header
        initial={{ y: -32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        className={`glass-nav ${styles.topBar} ${scrolled ? `glass-nav--scrolled ${styles.topBarScrolled}` : ''}`}
      >
        <div className={styles.topBarInner}>
          <div className={styles.topBarSide}>
            {/* Лого-кнопка (эталон Navbar: клик по знаку ведёт наверх). */}
            <button
              type="button"
              className={styles.bannerBrand}
              onClick={() => rootRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() })}
              aria-label={t('landing.toTop')}
              title={t('landing.toTop')}
            >
              <Avatar size={30} />
              <span className={styles.bannerBrandText}>
                <span className={styles.bannerBrandName}>Lexab</span>
                <span className={styles.bannerBrandSub}>{t('auth.tagline')}</span>
              </span>
            </button>
          </div>
          <nav className={styles.navPill} aria-label={t('landing.nav.aria')}>
            {NAV_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`nav-link ${styles.navBtn} ${activeSection === s.id ? styles.navBtnActive : ''}`}
                aria-current={activeSection === s.id ? 'true' : undefined}
                onClick={() => scrollToSection(s.id)}
              >
                {t(s.key)}
              </button>
            ))}
          </nav>
          <div className={`${styles.topBarSide} ${styles.topBarRight}`}>
            <div className={styles.controlsPill}>
              <LanguageMenu showLabel />
              <span className={styles.controlsDivider} />
              {/* Эталон ThemeToggle.tsx: AnimatePresence mode="wait",
                  rotate -90→0 (exit 90), duration 0.25 easeOut. */}
              <button
                type="button"
                className={styles.themeBtn}
                onClick={toggleTheme}
                aria-label={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
                title={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={dark ? 'dark' : 'light'}
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    style={{ display: 'flex' }}
                  >
                    {dark ? <Icon name="moon" size={18} /> : <Icon name="sun" size={18} />}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
            {/* Эталон Navbar.tsx: whileHover 1.02 / whileTap 0.98, 0.2s;
                плюс магнитное притяжение к курсору. */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.2 }}
              style={{ x: magX, y: magY }}
              onMouseMove={onCtaMouseMove}
              onMouseLeave={onCtaMouseLeave}
              className={styles.headerCta}
              onClick={startSignup}
            >
              {t('landing.navCta')}
            </motion.button>
          </div>
        </div>
      </motion.header>

      <main className={styles.main}>
      <div className={styles.layout}>
        {/* ── Left: brand, hero, sign-in card ─────────────────────────────── */}
        <div className={styles.left}>
          <div className={styles.brand}>
            <Avatar size={34} />
            <div>
              <div className={styles.brandName}>Lexab</div>
              <div className={styles.brandSub}>{t('auth.tagline')}</div>
            </div>
          </div>

          <div className={styles.leftInner}>
            <h1 className={styles.hero}>
              {/* Word-by-word cascade (эталон Hero): delay 0.1 + i*0.1. */}
              {heroWords.map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: EASE, delay: 0.1 + i * 0.1 }}
                  className={styles.heroWord}
                >
                  {word}
                  {'\u00a0'}
                </motion.span>
              ))}
              <br />
              <motion.span
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.1 + heroWords.length * 0.1 }}
                className={`${styles.heroWord} ${styles.heroAccent}`}
              >
                {t('auth.heroLine2')}
                {/* Анимация рисования — эталон Hero.tsx (pathLength 0.9s EASE
                    delay 0.8 + opacity 0.2s). Цвет — по просьбе пользователя:
                    тот же градиент, что у слова (#8B5CF6→#EC4899). */}
                <svg
                  className={styles.heroWave}
                  viewBox="0 0 300 20"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="lx-hero-wave" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#8B5CF6" />
                      <stop offset="1" stopColor="#EC4899" />
                    </linearGradient>
                  </defs>
                  <motion.path
                    d="M4 13 Q 34 5 64 12 T 124 12 T 184 12 T 244 12 T 296 11"
                    stroke="url(#lx-hero-wave)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{
                      pathLength: { duration: 0.9, ease: EASE, delay: 0.8 },
                      opacity: { duration: 0.2, delay: 0.8 },
                    }}
                  />
                </svg>
              </motion.span>
            </h1>
            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.4 }}
              className={styles.heroSub}
            >
              {t('auth.heroSub')}
            </motion.p>

            {/* Эталон Hero.tsx: контейнер y:24 delay 0.5; кнопки whileHover
                1.02 / whileTap 0.98 (0.2s); стрелка ghost — translate-x на
                hover (0.2s). Обработчики прежние. */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.5 }}
              className={styles.heroCtas}
            >
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className={styles.heroCtaOutline}
                onClick={() => scrollToSection('demo')}
              >
                <Icon name="play" size={15} />
                {t('landing.viewDemo')}
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className={styles.heroCtaGhost}
                onClick={() => scrollToSection('how-it-works')}
              >
                {t('landing.howItWorks')}
                <span className={styles.ctaArrow} aria-hidden="true">
                  <Icon name="arrowRight" size={17} />
                </span>
              </motion.button>
            </motion.div>

            {invite ? (
              <div className={styles.inviteNote}>
                <strong>{invite.inviterName}</strong> ({invite.inviterFirm}){' '}
                {t('auth.inviteNote', { role: t(`team.role.${invite.role}`) })}
                <div className={styles.inviteNoteEmail}>{invite.email}</div>
              </div>
            ) : null}
          </div>

          {/* Honest, measured metric: citation accuracy without vs with the
              law-corpus check (RAG eval on the golden set — see HANDOFF.md). */}
          {/* Эталон Hero.tsx: метрики — y:24, 0.7s EASE, delay 0.6. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}
            className={styles.stats}
          >
              <div className={styles.stat}>
                <div className={styles.statValue}>
                  <CountUp to={2.5} decimals={1} suffix="%" duration={3.5} />
                </div>
                <div className={styles.statLabel}>{t('auth.metricWithoutLabel')}</div>
              </div>
              <div className={styles.statArrow} aria-hidden="true">
                →
              </div>
              <div className={styles.stat}>
                <div className={`${styles.statValue} ${styles.statValueAccent}`}>
                  <CountUp to={100} suffix="%" duration={3.5} />
                </div>
                <div className={styles.statLabel}>{t('auth.metricWithLabel')}</div>
              </div>
            </motion.div>
        </div>

        {/* ── Right column: sign-in card + trust badges (эталон Hero) ─────── */}
        <div className={styles.rightCol}>
            {/* Эталон Hero.tsx: карточка y:28 delay 0.45; tilt — AuthCard.tsx
                (useSpring 160/20, perspective 900). */}
            <motion.div
              className={styles.cardWrap}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.45 }}
            >
            <motion.div
              ref={cardRef}
              onMouseMove={onCardMouseMove}
              onMouseLeave={onCardMouseLeave}
              style={{ rotateX, rotateY, transformPerspective: 900 }}
            >
            <GlassCard className={`${styles.card} sheen`}>
              {/* Блик, следующий за курсором вместе с 3D-наклоном. */}
              <motion.div
                aria-hidden="true"
                className={styles.cardGlare}
                style={{ background: glare, opacity: glareOpacity }}
              />
              {sessionExpired ? (
                <motion.p
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className={styles.verifySent}
                  role="status"
                >
                  <Icon name="clock" size={15} />
                  <span>{t('auth.sessionExpired')}</span>
                </motion.p>
              ) : null}

              <button type="button" className={styles.googleBtn} onClick={startGoogle}>
                <GoogleLogo />
                {t('auth.google')}
              </button>

              {/* Corporate SSO (Business). Quiet — most users use Google/email. */}
              {!ssoOpen ? (
                <button type="button" className={styles.ssoBtn} onClick={() => setSsoOpen(true)}>
                  <Icon name="shield" size={16} />
                  {t('auth.ssoButton')}
                </button>
              ) : (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  style={CLIP_STYLE}
                >
                <div className={styles.ssoRow}>
                  <TextField
                    label={t('auth.ssoEmailLabel')}
                    name="ssoEmail"
                    type="email"
                    value={ssoEmail}
                    autoFocus
                    onChange={(e) => setSsoEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void startSso();
                    }}
                  />
                  {/* Обводочная: единственная тёмная кнопка карточки — email. */}
                  <Button type="button" variant="secondary" disabled={ssoBusy} onClick={() => void startSso()}>
                    {ssoBusy ? t('common.loading') : t('auth.ssoContinue')}
                  </Button>
                </div>
                </motion.div>
              )}

              <div className={styles.divider}>
                <span>{t('auth.or')}</span>
              </div>

              {/* Плавная смена «кнопка → форма»: CTA гаснет, форма раскрывается
                  по высоте, поля всплывают каскадом. */}
              <AnimatePresence initial={false} mode="wait">
              {!emailOpen ? (
                <motion.div
                  key="email-cta"
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                <Button
                  type="button"
                  variant="primary"
                  icon="inbox"
                  className={styles.submit}
                  onClick={() => setEmailOpen(true)}
                >
                  {t('auth.emailContinue')}
                </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="email-form"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  style={CLIP_STYLE}
                >
                <div className={styles.emailBlock}>
                  <motion.h2
                    className={styles.formTitle}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut', delay: 0.12 }}
                  >
                    {title}
                  </motion.h2>
                  <AnimatePresence initial={false}>
                  {verifySentTo && mode === 'signin' ? (
                    <motion.p
                      key="verify-sent"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      style={CLIP_STYLE}
                      className={styles.verifySent}
                      role="status"
                    >
                      <Icon name="inbox" size={15} />
                      <span>
                        {t('auth.verifySentA')}
                        <strong>{verifySentTo}</strong>
                        {t('auth.verifySentB')}
                      </span>
                    </motion.p>
                  ) : null}
                  </AnimatePresence>
                  <AnimatePresence initial={false}>
                  {mode === 'reset' ? (
                    <motion.p
                      key="reset-hint"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      style={CLIP_STYLE}
                      className={styles.resetHint}
                    >
                      {t('auth.resetHint')}
                    </motion.p>
                  ) : null}
                  </AnimatePresence>

                  <motion.form
                    className={styles.form}
                    onSubmit={submit}
                    noValidate
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut', delay: 0.18 }}
                  >
                    <AnimatePresence initial={false}>
                    {mode === 'signup' ? (
                      <motion.div
                        key="name-field"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        style={CLIP_STYLE}
                      >
                      <TextField
                        label={t('auth.name')}
                        name="name"
                        value={name}
                        autoComplete="name"
                        onChange={(e) => setName(e.target.value)}
                      />
                      </motion.div>
                    ) : null}
                    </AnimatePresence>
                    <TextField
                      label={t('auth.email')}
                      name="email"
                      type="email"
                      value={email}
                      autoComplete="email"
                      onChange={(e) => {
                        setEmail(e.target.value);
                        // Editing the address invalidates a pending challenge.
                        if (twoFactor) {
                          setTwoFactor(false);
                          setCode('');
                        }
                      }}
                    />
                    <AnimatePresence initial={false}>
                    {mode !== 'reset' ? (
                      <motion.div
                        key="password-field"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        style={CLIP_STYLE}
                      >
                      <TextField
                        label={t('auth.password')}
                        name="password"
                        type="password"
                        value={password}
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      </motion.div>
                    ) : null}
                    </AnimatePresence>

                    <AnimatePresence initial={false}>
                    {mode === 'signin' && twoFactor ? (
                      <motion.div
                        key="totp"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        style={CLIP_STYLE}
                      >
                      <div className={styles.twoFactorBlock}>
                        <TextField
                          label={useBackupCode ? t('sec.2fa.backupCodeLabel') : t('sec.2fa.codeLabel')}
                          name="totp"
                          inputMode={useBackupCode ? 'text' : 'numeric'}
                          autoComplete="one-time-code"
                          autoFocus
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <button
                          type="button"
                          className={styles.forgotBtn}
                          onClick={() => {
                            setUseBackupCode((v) => !v);
                            setCode('');
                            setError(null);
                          }}
                        >
                          {useBackupCode ? t('sec.2fa.useAppCode') : t('sec.2fa.useBackupCode')}
                        </button>
                      </div>
                      </motion.div>
                    ) : null}
                    </AnimatePresence>

                    <AnimatePresence initial={false}>
                    {mode === 'signin' && !twoFactor ? (
                      <motion.div
                        key="forgot"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        style={CLIP_STYLE}
                      >
                      <button type="button" className={styles.forgotBtn} onClick={() => switchMode('reset')}>
                        {t('auth.forgot')}
                      </button>
                      </motion.div>
                    ) : null}
                    </AnimatePresence>

                    {/* Ошибка: мягко раскрывается + короткое покачивание. */}
                    <AnimatePresence initial={false}>
                    {error ? (
                      <motion.p
                        key={error}
                        className={styles.formError}
                        style={CLIP_STYLE}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          height: { duration: 0.25, ease: EASE },
                          opacity: { duration: 0.2 },
                          x: { duration: 0.4, ease: 'easeOut' },
                        }}
                      >
                        {error}
                      </motion.p>
                    ) : null}
                    </AnimatePresence>

                    <Button type="submit" variant="primary" className={styles.submit} disabled={status === 'loading' || resetBusy}>
                      <span className={styles.submitInner}>
                        {status === 'loading' || resetBusy ? (
                          <span className={styles.btnSpinner} aria-hidden="true" />
                        ) : null}
                        {status === 'loading' || resetBusy
                          ? t('common.loading')
                          : mode === 'signin'
                            ? twoFactor
                              ? t('sec.2fa.verify')
                              : t('auth.signIn')
                            : mode === 'signup'
                              ? t('auth.signUp')
                              : t('auth.resetSend')}
                      </span>
                    </Button>
                  </motion.form>

                  <motion.div
                    className={styles.switch}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut', delay: 0.26 }}
                  >
                    {mode === 'reset' ? (
                      <button className={styles.switchBtn} onClick={() => switchMode('signin')}>
                        {t('auth.backToSignIn')}
                      </button>
                    ) : (
                      <button
                        className={styles.switchBtn}
                        onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                      >
                        {mode === 'signin' ? t('auth.toSignUp') : t('auth.toSignIn')}
                      </button>
                    )}
                  </motion.div>
                </div>
                </motion.div>
              )}
              </AnimatePresence>

              <p className={styles.terms}>
                {t('auth.termsA')}
                <Link to="/terms" className={styles.termsLink}>
                  {t('auth.termsOfUse')}
                </Link>
                {t('auth.termsAnd')}
                <Link to="/privacy" className={styles.termsLink}>
                  {t('auth.privacyPolicy')}
                </Link>
                {t('auth.termsB')}
              </p>
            </GlassCard>
            </motion.div>
            </motion.div>

          {/* Verifiable trust signals — эталон Badges.tsx дословно:
              появление y:20, 0.6s EASE, delay 0.65+i*0.1; hover x:4 spring
              (stiffness 300, damping 22); стеклянная пилюля .glass.
              Когда открыта email-форма, карточка вырастает — бейджи плавно
              уходят (и возвращаются каскадом после закрытия формы). */}
          <AnimatePresence>
          {!emailOpen ? (
          <motion.ul
            className={styles.heroBadges}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {(
              [
                { icon: 'check', key: 'auth.badgeVerified' },
                { icon: 'globe', key: 'auth.badgeSources' },
                { icon: 'sparkle', key: 'auth.badgeAI' },
              ] as const
            ).map((b, i) => (
              <motion.li
                key={b.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.65 + i * 0.1 }}
              >
                <motion.div
                  whileHover={{ x: 4 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  className={`glass ${styles.heroBadge}`}
                >
                  <span className={styles.heroBadgeIcon}>
                    <Icon name={b.icon} size={16} />
                  </span>
                  <span>{t(b.key)}</span>
                </motion.div>
              </motion.li>
            ))}
          </motion.ul>
          ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Landing sections below the first screen ──────────────────────── */}
      <LandingSections onStart={startSignup} />
      </main>

      <TelegramWidget scrollRef={rootRef} hidden={leaving} />
    </div>
  );
}
