import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { Icon } from '@/components/icons/Icon';
import { authApi } from '@/api/auth.api';
import { ApiError } from '@/api/util';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import styles from './pages.module.css';

/** PUBLIC: /reset-password?token=… — set a new password from the letter. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { t } = useI18n();
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const pushToast = useUIStore((s) => s.pushToast);

  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 2FA challenge: сброс пароля на аккаунте с 2FA требует код (как вход).
  const [twoFactor, setTwoFactor] = useState(false);
  const [tfCode, setTfCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  // Один и тот же хук для обеих веток return (без токена / форма) — порядок
  // хуков не должен зависеть от ветки.
  const bodyReveal = useReveal<HTMLDivElement>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t('auth.errPassword'));
      return;
    }
    if (password !== password2) {
      setError(t('settings.passwordMismatch'));
      return;
    }
    if (twoFactor && !tfCode.trim()) {
      setError(t('sec.2fa.codeRequired'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const session = await authApi.confirmReset(
        token,
        password,
        twoFactor ? (useBackup ? { backupCode: tfCode.trim() } : { code: tfCode.trim() }) : undefined,
      );
      adoptSession(session.token, session.user); // proves mailbox → sign in
      pushToast(t('reset.done'), 'success');
      navigate('/chat', { replace: true });
    } catch (err) {
      if (!twoFactor && err instanceof ApiError && err.code === 'totp_required') {
        setTwoFactor(true); // не ошибка — открываем поле для кода
        return;
      }
      if (twoFactor && err instanceof ApiError && err.status === 401) {
        setError(t('sec.2fa.invalidCode'));
        return;
      }
      setError(err instanceof Error && err.message ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // No token in the link — it is malformed. Show the same "invalid link" screen
  // as VerifyEmailPage instead of a form that only fails on submit with a raw
  // validation error.
  if (!token) {
    return (
      <div className={styles.signPage}>
        <div className={styles.signHeader}>
          <Avatar size={30} />
          <span className={styles.signBrand}>Lexab</span>
        </div>
        <div className={styles.signBody} ref={bodyReveal}>
          <GlassCard className={styles.signCard} style={{ textAlign: 'center' }}>
            <div className={styles.signIcon} style={{ color: 'var(--danger)', display: 'flex', justifyContent: 'center' }}>
              <Icon name="alert" size={28} />
            </div>
            <h1 className={styles.signTitle}>{t('verify.errorTitle')}</h1>
            <p className={styles.signSub}>{t('verify.invalid')}</p>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.signPage}>
      <div className={styles.signHeader}>
        <Avatar size={30} />
        <span className={styles.signBrand}>Lexab</span>
      </div>
      <div className={styles.signBody} ref={bodyReveal}>
        <GlassCard className={styles.signCard} style={{ maxWidth: 440 }}>
          <h1 className={styles.signTitle}>{t('reset.title')}</h1>
          <p className={styles.signSub}>{t('reset.sub')}</p>
          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TextField
              label={t('reset.newPassword')}
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              label={t('settings.confirmPassword')}
              name="password2"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
            {twoFactor ? (
              <>
                <TextField
                  label={useBackup ? t('sec.2fa.backupCodeLabel') : t('sec.2fa.codeLabel')}
                  name="tfCode"
                  autoComplete="one-time-code"
                  value={tfCode}
                  onChange={(e) => setTfCode(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    setUseBackup((v) => !v);
                    setTfCode('');
                  }}
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 13, color: 'var(--acc)', cursor: 'pointer' }}
                >
                  {useBackup ? t('sec.2fa.useAppCode') : t('sec.2fa.useBackupCode')}
                </button>
              </>
            ) : null}
            {error ? <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p> : null}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('common.loading') : t('reset.submit')}
            </Button>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}
