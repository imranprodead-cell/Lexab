import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { authApi } from '@/api/auth.api';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
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
    setError(null);
    setBusy(true);
    try {
      const session = await authApi.confirmReset(token, password);
      adoptSession(session.token, session.user); // proves mailbox → sign in
      pushToast(t('reset.done'), 'success');
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.signPage}>
      <div className={styles.signHeader}>
        <Avatar size={30} />
        <span className={styles.signBrand}>LexAI</span>
      </div>
      <div className={styles.signBody}>
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
