import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { shareApi, type PublicReport } from '@/api/growth.api';
import { localeFor } from '@/i18n/dates';
import { useI18n } from '@/i18n/I18nProvider';
import { useReveal } from '@/hooks/useReveal';
import type { Severity } from '@/types/domain';
import styles from './pages.module.css';

const SEV_COLOR: Record<Severity, string> = { High: 'var(--danger)', Medium: 'var(--sev-med)', Low: 'var(--sev-low)' };

/**
 * ПУБЛИЧНЫЙ отчёт анализа по токен-ссылке (/share/:token) — для клиента или
 * контрагента без аккаунта: балл риска, резюме и находки с цитатами норм.
 * Каждый просмотр — витрина продукта, поэтому внизу честный CTA.
 */
export function SharePage() {
  const { token } = useParams();
  const { t, lang } = useI18n();
  const [report, setReport] = useState<PublicReport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    const controller = new AbortController();
    shareApi
      .publicReport(token, controller.signal)
      .then((r) => {
        setReport(r);
        setState('ready');
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setState('error');
      });
    return () => controller.abort();
  }, [token]);

  return (
    <div className={styles.signPage}>
      <div className={styles.signHeader}>
        <Avatar size={30} />
        <span className={styles.signBrand}>Lexab</span>
      </div>
      <div className={`${styles.signBody} scroll`} ref={useReveal()}>
        <GlassCard className={styles.signCard} style={{ maxWidth: 720, width: '100%' }}>
          {state === 'loading' ? (
            <p className={styles.signSub}>{t('common.loading')}</p>
          ) : state === 'error' || !report ? (
            <div style={{ textAlign: 'center' }}>
              <div className={styles.signIcon} style={{ color: 'var(--danger)', display: 'flex', justifyContent: 'center' }}>
                <Icon name="alert" size={28} />
              </div>
              <h1 className={styles.signTitle}>{t('share.invalidTitle')}</h1>
              <p className={styles.signSub}>{t('share.invalidBody')}</p>
            </div>
          ) : (
            <>
              <p className={styles.signSub} style={{ marginBottom: 4 }}>
                {t('share.preparedBy', { firm: report.firm })} ·{' '}
                {new Date(report.analyzedAt).toLocaleDateString(localeFor(lang))}
              </p>
              <h1 className={styles.signTitle} style={{ marginBottom: 14 }}>
                {report.fileName}
              </h1>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div className={styles.rowCard} style={{ minWidth: 130, cursor: 'default' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: SEV_COLOR[report.riskLevel === 'Elevated' ? 'Medium' : (report.riskLevel as Severity)] ?? 'var(--text)' }}>
                    {report.riskScore}
                  </div>
                  <div className={styles.metaText}>{t('share.riskScore')}</div>
                </div>
                <div className={styles.rowCard} style={{ minWidth: 130, cursor: 'default' }}>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{report.clausesReviewed}</div>
                  <div className={styles.metaText}>{t('share.clauses')}</div>
                </div>
                <div className={styles.rowCard} style={{ minWidth: 130, cursor: 'default' }}>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{report.findings.length}</div>
                  <div className={styles.metaText}>{t('share.findings')}</div>
                </div>
              </div>

              <p style={{ lineHeight: 1.6, marginBottom: 18 }} dir="auto">
                {report.summary}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {report.findings.map((f, i) => (
                  <div key={i} className={styles.rowCard} style={{ cursor: 'default' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Badge color={SEV_COLOR[f.severity]} plain>
                        {t(`sev.${f.severity}`)}
                      </Badge>
                      <strong style={{ fontSize: 14 }}>{f.title}</strong>
                    </div>
                    <div className={styles.metaText} style={{ marginTop: 4 }}>
                      {f.citation}
                      {f.verified ? ` · ${t('finding.verified')}` : ''}
                    </div>
                  </div>
                ))}
              </div>

              <p className={styles.metaText} style={{ marginTop: 18 }}>
                {t('share.disclaimer')}
              </p>
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <Link to="/login" className={styles.verifyCta}>
                  {t('share.cta')}
                </Link>
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
