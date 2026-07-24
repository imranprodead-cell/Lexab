import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { Icon } from '@/components/icons/Icon';
import { http } from '@/api/client';
import { useI18n } from '@/i18n/I18nProvider';
import { usePageTitle } from '@/hooks/usePageTitle';
import styles from './pages.module.css';

interface SignInfo {
  documentName: string;
  ownerName: string;
  ownerFirm: string;
  recipient: { name: string; email: string };
  signed: boolean;
  signedAt: string | null;
  documentText: string | null;
}

/** PUBLIC signing page (/sign/:token) — no account needed. */
export function SignPage() {
  const { token = '' } = useParams();
  const { t } = useI18n();
  usePageTitle(t('sign.pageTitle'));

  const [info, setInfo] = useState<SignInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    http<SignInfo>(`/sign/${encodeURIComponent(token)}`)
      .then((data) => {
        setInfo(data);
        setName(data.recipient.name);
        if (data.signed) setDone(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('common.error')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const sign = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await http(`/sign/${encodeURIComponent(token)}`, { method: 'POST', body: { name: name.trim() } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.signPage}>
      <div className={styles.signHeader}>
        <Avatar size={30} />
        <span className={styles.signBrand}>Lexab</span>
      </div>

      <div className={styles.signBody}>
        {error && !info ? (
          <GlassCard className={styles.signCard}>
            <div className={styles.signIcon} style={{ color: 'var(--danger)' }}>
              <Icon name="alert" size={26} />
            </div>
            <h1 className={styles.signTitle}>{t('sign.invalidTitle')}</h1>
            <p className={styles.signSub}>{error}</p>
          </GlassCard>
        ) : !info ? (
          <GlassCard className={styles.signCard}>
            <p className={styles.signSub}>{t('common.loading')}</p>
          </GlassCard>
        ) : done ? (
          <GlassCard className={styles.signCard}>
            <div className={styles.signIcon} style={{ color: 'var(--sev-low)' }}>
              <Icon name="check" size={26} />
            </div>
            <h1 className={styles.signTitle}>{t('sign.doneTitle')}</h1>
            <p className={styles.signSub}>{t('sign.doneBody', { doc: info.documentName })}</p>
          </GlassCard>
        ) : (
          <GlassCard className={styles.signCard}>
            <h1 className={styles.signTitle}>{info.documentName}</h1>
            <p className={styles.signSub}>
              {t('sign.requestedBy', { name: info.ownerName, firm: info.ownerFirm })}
            </p>

            {info.documentText ? (
              <div className={`${styles.signDoc} scroll`}>{info.documentText}</div>
            ) : (
              <p className={styles.signNoPreview}>{t('sign.noPreview')}</p>
            )}

            <div className={styles.signForm}>
              <TextField
                label={t('sign.yourName')}
                name="signName"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {error ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{error}</p> : null}
              <p className={styles.signAgree}>{t('sign.agree')}</p>
              <Button variant="primary" icon="esign" disabled={busy || !name.trim()} onClick={() => void sign()}>
                {busy ? t('common.loading') : t('sign.signAction')}
              </Button>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
