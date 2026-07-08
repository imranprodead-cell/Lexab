import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge, RiskBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { documentsApi, versionsApi } from '@/api';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { ContractStatus } from '@/types/domain';
import styles from './pages.module.css';

const STATUS_TONE: Record<ContractStatus, string> = {
  Draft: 'var(--mut)',
  'In review': 'var(--sev-med)',
  Reviewed: 'var(--accent)',
  Signed: 'var(--sev-low)',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Detail view for a single contract: metadata, versions, and actions. */
export function DocumentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const seedAnalyzed = useChatStore((s) => s.seedAnalyzed);

  const { data: doc, loading, error, reload } = useAsync((signal) => documentsApi.get(id, signal), [id]);
  const { data: versions } = useAsync((signal) => versionsApi.list(id, signal), [id]);

  const openWorkspace = () => {
    seedAnalyzed();
    navigate('/workspace');
  };

  return (
    <div className={styles.page}>
      <TopBar
        title={t('nav.documents')}
        left={
          <button
            className={styles.backBtn}
            onClick={() => navigate('/documents')}
            aria-label={t('common.back')}
          >
            <Icon name="back" size={18} />
          </button>
        }
      />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container} style={{ maxWidth: 820 }}>
          {loading ? (
            <LoadingState label={t('common.loading')} />
          ) : error || !doc ? (
            <ErrorState message={error ?? t('common.error')} onRetry={reload} />
          ) : (
            <>
              <div className={styles.docDetailHead}>
                <div className={styles.docDetailIcon}>
                  <Icon name="docs" size={26} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h1 className={styles.docDetailName}>{doc.name}</h1>
                  <p className={styles.docDetailMeta}>{doc.counterparty}</p>
                </div>
              </div>

              <div className={styles.docMetaGrid}>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.status')}</span>
                  <Badge color={STATUS_TONE[doc.status]} plain>{doc.status}</Badge>
                </div>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.risk')}</span>
                  <RiskBadge risk={doc.risk} plain />
                </div>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.jurisdiction')}</span>
                  <span className={styles.mono}>{doc.jurisdiction}</span>
                </div>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.updated')}</span>
                  <span className={styles.metaText}>{formatDate(doc.updatedAt)}</span>
                </div>
              </div>

              <div className={styles.docActions}>
                <Button variant="primary" icon="layout" onClick={openWorkspace}>
                  {t('analysis.openWorkspace')}
                </Button>
                <Button variant="secondary" icon="esign" onClick={() => pushToast('Открываю отправку на подпись…')}>
                  {t('nav.signatures')}
                </Button>
                <Button variant="secondary" icon="download" onClick={() => pushToast('Готовлю DOCX…', 'success')}>
                  DOCX
                </Button>
              </div>

              <section className={styles.section} style={{ marginTop: 24 }}>
                <h2 className={styles.sectionTitle} style={{ marginBottom: 14 }}>
                  {t('nav.documents')} — история версий
                </h2>
                {(versions ?? []).map((v) => (
                  <div key={v.id} className={styles.versionRow}>
                    <span className={styles.versionDot} />
                    <div>
                      <div className={styles.versionLabel}>{v.label}</div>
                      <div className={styles.versionMeta}>
                        {v.author} · {formatDate(v.createdAt)}
                      </div>
                      <div className={styles.versionNote}>{v.note}</div>
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
