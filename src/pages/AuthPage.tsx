import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { useReveal } from '@/hooks/useReveal';
import { useTilt } from '@/hooks/useTilt';
import { useI18n } from '@/i18n/I18nProvider';
import { usePageTitle } from '@/hooks/usePageTitle';
import { scrollBehavior } from '@/lib/scroll';
import styles from './auth.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

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
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { root: rootRef.current, rootMargin: '-35% 0px -55% 0px' },
    );
    const watched = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    watched.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [finishing]);

  // Reveal cascade + card tilt (эталон Hero/AuthCard). Hooks are hoisted above
  // the `finishing` early return so the hook order never changes.
  const heroSubReveal = useReveal<HTMLParagraphElement>(0.4);
  const heroCtasReveal = useReveal<HTMLDivElement>(0.5);
  /* Бейджи доверия под карточкой — каскад эталона (delay 0.65). */
  const badgesReveal = useReveal<HTMLDivElement>(0.65);
  const cardReveal = useReveal<HTMLDivElement>(0.45);
  const statsReveal = useReveal<HTMLDivElement>(0.6);
  const statNoteReveal = useReveal<HTMLDivElement>(0.65);
  const cardTilt = useTilt<HTMLDivElement>();
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

      {/* ── Fixed glass top bar (эталон Navbar): brand · nav links · controls ── */}
      <header
        className={`glass-nav ${styles.topBar} ${scrolled ? `glass-nav--scrolled ${styles.topBarScrolled}` : ''}`}
      >
        <div className={styles.topBarInner}>
          <div className={styles.topBarSide}>
            <div className={styles.bannerBrand}>
              <Avatar size={30} />
              <span className={styles.bannerBrandText}>
                <span className={styles.bannerBrandName}>Lexab</span>
                <span className={styles.bannerBrandSub}>{t('auth.tagline')}</span>
              </span>
            </div>
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
              <button
                type="button"
                className={styles.themeBtn}
                onClick={toggleTheme}
                aria-label={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
                title={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
              >
                <Icon name={dark ? 'moon' : 'sun'} size={17} />
              </button>
            </div>
            <button type="button" className={styles.headerCta} onClick={startSignup}>
              {t('landing.navCta')}
            </button>
          </div>
        </div>
      </header>

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
                <span
                  key={`${word}-${i}`}
                  className={styles.heroWord}
                  style={{ animationDelay: `${0.1 + i * 0.1}s` }}
                >
                  {word}
                  {'\u00a0'}
                </span>
              ))}
              <br />
              <span
                className={`${styles.heroWord} ${styles.heroAccent}`}
                style={{ animationDelay: `${0.1 + heroWords.length * 0.1}s` }}
              >
                {t('auth.heroLine2')}
                {/* Hand-drawn wavy underline, drawn in on load (эталон). */}
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
                  <path
                    className={styles.heroWavePath}
                    d="M4 13 Q 34 5 64 12 T 124 12 T 184 12 T 244 12 T 296 11"
                    stroke="url(#lx-hero-wave)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    pathLength={1}
                  />
                </svg>
              </span>
            </h1>
            <p className={styles.heroSub} ref={heroSubReveal}>{t('auth.heroSub')}</p>

            {/* Порядок эталона: «Посмотреть демо» — обводочная, «Как это
                работает» — тихая текстовая. Обработчики прежние. */}
            <div className={styles.heroCtas} ref={heroCtasReveal}>
              <button type="button" className={styles.heroCtaOutline} onClick={() => scrollToSection('demo')}>
                <Icon name="play" size={15} />
                {t('landing.viewDemo')}
              </button>
              <button type="button" className={styles.heroCtaGhost} onClick={() => scrollToSection('how-it-works')}>
                {t('landing.howItWorks')}
                <Icon name="arrowRight" size={17} />
              </button>
            </div>

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
          <div className={styles.stats} ref={statsReveal}>
              <div className={styles.stat}>
                <div className={styles.statValue}>
                  <CountUp to={2.5} decimals={1} suffix="%" />
                </div>
                <div className={styles.statLabel}>{t('auth.metricWithoutLabel')}</div>
              </div>
              <div className={styles.statArrow} aria-hidden="true">
                →
              </div>
              <div className={styles.stat}>
                <div className={`${styles.statValue} ${styles.statValueAccent}`}>
                  <CountUp to={100} suffix="%" />
                </div>
                <div className={styles.statLabel}>{t('auth.metricWithLabel')}</div>
              </div>
            </div>
          <div className={styles.statNote} ref={statNoteReveal}>{t('auth.metricNote')}</div>
        </div>

        {/* ── Right column: sign-in card + trust badges (эталон Hero) ─────── */}
        <div className={styles.rightCol}>
            <div className={styles.cardWrap} ref={cardReveal}>
            <div ref={cardTilt}>
            <GlassCard className={`${styles.card} sheen`}>
              {sessionExpired ? (
                <p className={styles.verifySent} role="status">
                  <Icon name="clock" size={15} />
                  <span>{t('auth.sessionExpired')}</span>
                </p>
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
              )}

              <div className={styles.divider}>
                <span>{t('auth.or')}</span>
              </div>

              {!emailOpen ? (
                <Button
                  type="button"
                  variant="primary"
                  icon="inbox"
                  className={styles.submit}
                  onClick={() => setEmailOpen(true)}
                >
                  {t('auth.emailContinue')}
                </Button>
              ) : (
                <div className={styles.emailBlock}>
                  <h2 className={styles.formTitle}>{title}</h2>
                  {verifySentTo && mode === 'signin' ? (
                    <p className={styles.verifySent} role="status">
                      <Icon name="inbox" size={15} />
                      <span>
                        {t('auth.verifySentA')}
                        <strong>{verifySentTo}</strong>
                        {t('auth.verifySentB')}
                      </span>
                    </p>
                  ) : null}
                  {mode === 'reset' ? <p className={styles.resetHint}>{t('auth.resetHint')}</p> : null}

                  <form className={styles.form} onSubmit={submit} noValidate>
                    {mode === 'signup' ? (
                      <TextField
                        label={t('auth.name')}
                        name="name"
                        value={name}
                        autoComplete="name"
                        onChange={(e) => setName(e.target.value)}
                      />
                    ) : null}
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
                    {mode !== 'reset' ? (
                      <TextField
                        label={t('auth.password')}
                        name="password"
                        type="password"
                        value={password}
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    ) : null}

                    {mode === 'signin' && twoFactor ? (
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
                    ) : null}

                    {mode === 'signin' && !twoFactor ? (
                      <button type="button" className={styles.forgotBtn} onClick={() => switchMode('reset')}>
                        {t('auth.forgot')}
                      </button>
                    ) : null}

                    {error ? <p className={styles.formError}>{error}</p> : null}

                    <Button type="submit" variant="primary" className={styles.submit} disabled={status === 'loading' || resetBusy}>
                      {status === 'loading' || resetBusy
                        ? t('common.loading')
                        : mode === 'signin'
                          ? twoFactor
                            ? t('sec.2fa.verify')
                            : t('auth.signIn')
                          : mode === 'signup'
                            ? t('auth.signUp')
                            : t('auth.resetSend')}
                    </Button>
                  </form>

                  <div className={styles.switch}>
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
                  </div>
                </div>
              )}

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
            </div>
            </div>

          {/* Verifiable trust signals — every line is true and checkable. */}
          <div className={styles.heroBadges} ref={badgesReveal}>
            {(
              [
                { icon: 'check', key: 'auth.badgeVerified' },
                { icon: 'globe', key: 'auth.badgeSources' },
                { icon: 'sparkle', key: 'auth.badgeAI' },
              ] as const
            ).map((b) => (
              <div key={b.key} className={styles.heroBadge}>
                <span className={styles.heroBadgeIcon}>
                  <Icon name={b.icon} size={14} />
                </span>
                {t(b.key)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Landing sections below the first screen ──────────────────────── */}
      <LandingSections onStart={startSignup} />
      </main>

      <TelegramWidget scrollRef={rootRef} hidden={leaving} />
    </div>
  );
}
