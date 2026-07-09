import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/icons/Icon';
import { authApi } from '@/api/auth.api';
import { userApi } from '@/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

/** PUBLIC: /verify-email?token=… — confirms the address from the letter. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { t } = useI18n();
  const authToken = useAuthStore((s) => s.token);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage(t('verify.invalid'));
      return;
    }
    authApi
      .verifyEmail(token)
      .then(async () => {
        setState('done');
        // Signed in on this device — refresh the profile so the banner hides.
        if (authToken) {
          try {
            updateProfile(await userApi.me());
          } catch {
            /* profile refresh is best-effort */
          }
        }
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof Error && err.message ? err.message : t('verify.invalid'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className={styles.signPage}>
      <div className={styles.signHeader}>
        <Avatar size={30} />
        <span className={styles.signBrand}>LexAI</span>
      </div>
      <div className={styles.signBody}>
        <GlassCard className={styles.signCard} style={{ textAlign: 'center' }}>
          {state === 'working' ? (
            <p className={styles.signSub}>{t('common.loading')}</p>
          ) : state === 'done' ? (
            <>
              <div className={styles.signIcon} style={{ color: 'var(--sev-low)', display: 'flex', justifyContent: 'center' }}>
                <Icon name="check" size={28} />
              </div>
              <h1 className={styles.signTitle}>{t('verify.doneTitle')}</h1>
              <p className={styles.signSub}>{t('verify.doneBody')}</p>
              <Link to={authToken ? '/chat' : '/login'} className={styles.verifyCta}>
                {authToken ? t('verify.toApp') : t('verify.toLogin')}
              </Link>
            </>
          ) : (
            <>
              <div className={styles.signIcon} style={{ color: 'var(--danger)', display: 'flex', justifyContent: 'center' }}>
                <Icon name="alert" size={28} />
              </div>
              <h1 className={styles.signTitle}>{t('verify.errorTitle')}</h1>
              <p className={styles.signSub}>{message}</p>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
