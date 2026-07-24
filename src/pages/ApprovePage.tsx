import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/icons/Icon';
import { http } from '@/api/client';
import { useI18n } from '@/i18n/I18nProvider';
import { usePageTitle } from '@/hooks/usePageTitle';
import styles from './pages.module.css';

interface ChainStep {
  ord: number;
  name: string;
  role: string | null;
  status: 'waiting' | 'pending' | 'approved' | 'rejected';
  dueAt: string | null;
  comment: string | null;
}

interface ApproveInfo {
  documentName: string;
  ownerName: string;
  ownerFirm: string;
  flowStatus: 'active' | 'approved' | 'rejected' | 'cancelled';
  me: ChainStep;
  chain: ChainStep[];
  documentText: string | null;
}

/** PUBLIC: /approve/:token — one approver's decision page (no account). */
export function ApprovePage() {
  const { token = '' } = useParams();
  const { t, lang } = useI18n();
  usePageTitle(t('approve.pageTitle'));

  const [info, setInfo] = useState<ApproveInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);

  useEffect(() => {
    http<ApproveInfo>(`/approve/${encodeURIComponent(token)}`)
      .then((data) => {
        setInfo(data);
        if (data.me.status === 'approved' || data.me.status === 'rejected') setDecided(data.me.status);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('common.error')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const decide = async (decision: 'approved' | 'rejected') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await http(`/approve/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: { decision, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      setDecided(decision);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const dotColor = (s: ChainStep['status']) =>
    s === 'approved' ? 'var(--sev-low)' : s === 'rejected' ? 'var(--sev-high)' : s === 'pending' ? 'var(--sev-med)' : 'var(--border)';

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
            <h1 className={styles.signTitle}>{t('appr.invalidTitle')}</h1>
            <p className={styles.signSub}>{error}</p>
          </GlassCard>
        ) : !info ? (
          <GlassCard className={styles.signCard}>
            <p className={styles.signSub}>{t('common.loading')}</p>
          </GlassCard>
        ) : decided ? (
          <GlassCard className={styles.signCard}>
            <div className={styles.signIcon} style={{ color: decided === 'approved' ? 'var(--sev-low)' : 'var(--sev-high)' }}>
              <Icon name={decided === 'approved' ? 'check' : 'x'} size={26} />
            </div>
            <h1 className={styles.signTitle}>{t(decided === 'approved' ? 'appr.doneApproved' : 'appr.doneRejected')}</h1>
            <p className={styles.signSub}>{t('appr.doneBody', { doc: info.documentName })}</p>
          </GlassCard>
        ) : (
          <GlassCard className={styles.signCard}>
            <h1 className={styles.signTitle}>{info.documentName}</h1>
            <p className={styles.signSub}>
              {t('appr.requestedBy', { name: info.ownerName, firm: info.ownerFirm })}
              {info.me.role ? ` · ${t('appr.yourStep')}: ${info.me.role}` : ''}
              {info.me.dueAt
                ? ` · ${t('appr.due')} ${new Date(info.me.dueAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}`
                : ''}
            </p>

            <div className={styles.apprChain} style={{ marginBottom: 16 }}>
              {info.chain.map((s) => (
                <div key={s.ord} className={styles.apprStep}>
                  <span className={styles.apprDot} style={{ background: dotColor(s.status) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={styles.apprName}>
                      {s.ord + 1}. {s.name}
                      {s.role ? <span className={styles.apprRole}> · {s.role}</span> : null}
                    </div>
                    <div className={styles.apprMeta}>{t(`appr.step.${s.status}`)}</div>
                  </div>
                </div>
              ))}
            </div>

            {info.documentText ? (
              <div className={`${styles.signDoc} scroll`}>{info.documentText}</div>
            ) : (
              <p className={styles.signNoPreview}>{t('sign.noPreview')}</p>
            )}

            {info.me.status === 'pending' ? (
              <div className={styles.signForm}>
                <textarea
                  className={styles.apprComment}
                  placeholder={t('appr.commentPh')}
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                {error ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p> : null}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button variant="primary" icon="check" disabled={busy} onClick={() => void decide('approved')}>
                    {busy ? t('common.loading') : t('appr.approve')}
                  </Button>
                  <Button variant="ghost" icon="x" disabled={busy} onClick={() => void decide('rejected')}>
                    {t('appr.reject')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className={styles.signNoPreview}>{t('appr.notYourTurn')}</p>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  );
}
