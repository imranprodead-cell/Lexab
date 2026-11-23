import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/icons/Icon';
import { authApi } from '@/api/auth.api';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import styles from './pages.module.css';

/**
 * PUBLIC: /confirm-email?token=… — подтверждение СМЕНЫ адреса из письма.
 *
 * Сервер (POST /auth/confirm-email) меняет адрес и обнуляет все сеансы
 * аккаунта — обладание письмом не должно заменять вход. Поэтому здесь сессия
 * не выдаётся, а локальная снимается: держать токен, который сервер уже
 * отозвал, — значит через минуту получить «сеанс истёк» посреди работы.
 *
 * До 23.11.2026 этой страницы не было: письмо вело на «не найдено», и смена
 * почты не завершалась никогда.
 */
export function ConfirmEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { t } = useI18n();
  const logout = useAuthStore((s) => s.logout);

  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  const [newEmail, setNewEmail] = useState('');
  // Ссылка одноразовая: второй запрос с тем же кодом сервер отклонит, и
  // человек увидел бы ошибку поверх успеха.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState('error');
      setMessage(t('verify.invalid'));
      return;
    }
    authApi
      .confirmEmailChange(token)
      .then(({ email }) => {
        if (useAuthStore.getState().token) logout();
        setNewEmail(email);
        setState('done');
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
        <span className={styles.signBrand}>Lexab</span>
      </div>
      <div className={styles.signBody} ref={useReveal()}>
        <GlassCard className={styles.signCard} style={{ textAlign: 'center' }}>
          {state === 'working' ? (
            <p className={styles.signSub}>{t('common.loading')}</p>
          ) : state === 'done' ? (
            <>
              <div className={styles.signIcon} style={{ color: 'var(--sev-low)', display: 'flex', justifyContent: 'center' }}>
                <Icon name="check" size={28} />
              </div>
              <h1 className={styles.signTitle}>{t('confirmEmail.doneTitle')}</h1>
              <p className={styles.signSub}>{t('confirmEmail.doneBody', { email: newEmail })}</p>
              <Link to="/login" className={styles.verifyCta}>
                {t('verify.toLogin')}
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
