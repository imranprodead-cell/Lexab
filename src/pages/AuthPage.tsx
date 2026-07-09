import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { Icon } from '@/components/icons/Icon';
import { teamApi } from '@/api';
import { authApi } from '@/api/auth.api';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { LANGUAGES } from '@/i18n/messages';
import type { UserProfile } from '@/types/domain';
import styles from './auth.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

type Mode = 'signin' | 'signup' | 'reset';

/** Decode the `#session=` fragment produced by the Google OAuth callback. */
function decodeSession(fragment: string): { token: string; user: UserProfile } | null {
  try {
    const b64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { token?: unknown; user?: unknown };
    if (typeof parsed.token === 'string' && parsed.user && typeof parsed.user === 'object') {
      return parsed as { token: string; user: UserProfile };
    }
    return null;
  } catch {
    return null;
  }
}

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

/** Sign-in / sign-up screen: Google OAuth + expandable email form. */
export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang, setLang } = useI18n();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const status = useAuthStore((s) => s.status);
  const pushToast = useUIStore((s) => s.pushToast);

  const token = useAuthStore((s) => s.token);

  const [emailOpen, setEmailOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Returning from Google with a session: show the branded "signing in"
   *  screen instead of flashing the login form. */
  const [finishing, setFinishing] = useState(() => window.location.hash.startsWith('#session='));
  /** Fade the whole screen out before navigating into the app. */
  const [leaving, setLeaving] = useState(false);

  // Team invite link (/login?invite=<token>): show who invites and land on /team.
  const inviteToken = new URLSearchParams(location.search).get('invite');
  const [invite, setInvite] = useState<{ inviterName: string; inviterFirm: string; email: string; role: string } | null>(null);
  useEffect(() => {
    if (!inviteToken) return;
    teamApi
      .inviteInfo(inviteToken)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [inviteToken]);

  const redirectTo = inviteToken ? '/team' : ((location.state as { from?: string } | null)?.from ?? '/chat');

  // The Google callback returns here with #session=<payload> (or #error=<code>).
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#session=')) {
      const session = decodeSession(hash.slice('#session='.length));
      window.history.replaceState(null, '', window.location.pathname);
      if (session) {
        adoptSession(session.token, session.user);
      } else {
        setFinishing(false);
        pushToast(t('auth.googleFailed'), 'error');
      }
    } else if (hash.startsWith('#error=')) {
      window.history.replaceState(null, '', window.location.pathname);
      pushToast(t('auth.googleFailed'), 'error');
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
      setError(null);
      try {
        await authApi.requestReset(email.trim());
      } catch {
        /* never reveal whether the address exists */
      }
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
    setError(null);
    try {
      if (mode === 'signin') await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
      departAnd(() => navigate(redirectTo, { replace: true }));
    } catch (err) {
      // Surface the real backend message ("Invalid email or password", …).
      setError(err instanceof Error && err.message ? err.message : t('common.error'));
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  // Branded hand-off screen while the Google session settles in.
  if (finishing) {
    return (
      <div className={`${styles.auth} ${styles.finishScreen}`}>
        <div className={styles.finishInner}>
          <Avatar size={56} />
          <div className={styles.finishText}>{t('auth.signingIn')}</div>
          <div className={styles.finishBar}>
            <div />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.auth} ${leaving ? styles.authLeaving : ''}`}>
      <div className={styles.langRow}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            className={`${styles.langBtn} ${lang === l.code ? styles.langBtnActive : ''}`}
            onClick={() => setLang(l.code)}
          >
            {l.short}
          </button>
        ))}
      </div>

      <div className={styles.layout}>
        {/* ── Left: brand, hero, sign-in card ─────────────────────────────── */}
        <div className={styles.left}>
          <div className={styles.brand}>
            <Avatar size={34} />
            <div>
              <div className={styles.brandName}>LexAI</div>
              <div className={styles.brandSub}>{t('auth.tagline')}</div>
            </div>
          </div>

          <div className={styles.leftInner}>
            <h1 className={styles.hero}>
              {t('auth.heroLine1')}
              <br />
              <span className={styles.heroAccent}>{t('auth.heroLine2')}</span>
            </h1>
            <p className={styles.heroSub}>{t('auth.heroSub')}</p>

            {invite ? (
              <div className={styles.inviteNote}>
                <strong>{invite.inviterName}</strong> ({invite.inviterFirm}){' '}
                {t('auth.inviteNote', { role: t(`team.role.${invite.role}`) })}
                <div className={styles.inviteNoteEmail}>{invite.email}</div>
              </div>
            ) : null}

            <GlassCard className={styles.card}>
              <button type="button" className={styles.googleBtn} onClick={startGoogle}>
                <GoogleLogo />
                {t('auth.google')}
              </button>

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
                      onChange={(e) => setEmail(e.target.value)}
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

                    {mode === 'signin' ? (
                      <button type="button" className={styles.forgotBtn} onClick={() => switchMode('reset')}>
                        {t('auth.forgot')}
                      </button>
                    ) : null}

                    {error ? <p className={styles.formError}>{error}</p> : null}

                    <Button type="submit" variant="primary" className={styles.submit} disabled={status === 'loading'}>
                      {status === 'loading'
                        ? t('common.loading')
                        : mode === 'signin'
                          ? t('auth.signIn')
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

          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statValue}>50.000</div>
              <div className={styles.statLabel}>{t('auth.statDocs')}</div>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <div className={styles.statValue}>95%+</div>
              <div className={styles.statLabel}>{t('auth.statAccuracy')}</div>
            </div>
          </div>
        </div>

        {/* ── Right: decorative panel (hidden on narrow screens) ──────────── */}
        <div className={styles.right} aria-hidden="true">
          <div className={styles.rightGrid} />
          <div className={styles.rightOrb} />
          <div className={styles.rightOrbSmall} />
          <div className={styles.rightMark}>
            <div className={styles.rightDiamond}>
              <Icon name="diamond" size={64} color="var(--on-accent)" strokeWidth={1.8} />
            </div>
            <div className={styles.rightCaption}>
              LexAI <span>· {t('auth.tagline')}</span>
            </div>

            <div className={styles.rightCards}>
              {(
                [
                  { icon: 'alert', title: 'auth.featRiskTitle', text: 'auth.featRiskText' },
                  { icon: 'pen', title: 'auth.featRedlineTitle', text: 'auth.featRedlineText' },
                  { icon: 'chat', title: 'auth.featQaTitle', text: 'auth.featQaText' },
                ] as const
              ).map((f) => (
                <div key={f.icon} className={styles.rightCard}>
                  <span className={styles.rightCardIcon}>
                    <Icon name={f.icon} size={17} />
                  </span>
                  <div>
                    <div className={styles.rightCardTitle}>{t(f.title)}</div>
                    <div className={styles.rightCardText}>{t(f.text)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.rightTrust}>
            <div className={styles.rightAvatars}>
              {(['analytics', 'users', 'shield'] as const).map((icon) => (
                <span key={icon} className={styles.rightAvatar}>
                  <Icon name={icon} size={12} />
                </span>
              ))}
            </div>
            <div className={styles.rightTrustText}>
              {t('auth.trustedPre')}
              <b>{t('auth.trustedCount')}</b>
              {t('auth.trustedPost')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
