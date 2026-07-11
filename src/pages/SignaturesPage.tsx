import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { signaturesApi } from '@/api';
import type { SignatureRequest, SignatureStatus } from '@/types/domain';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

const STATUS_TONE: Record<SignatureStatus, string> = {
  Draft: 'var(--mut)',
  Sent: 'var(--sev-med)',
  Viewed: 'var(--accent)',
  Completed: 'var(--sev-low)',
  Declined: 'var(--sev-high)',
};

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function formatDateFull(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** E-signature request tracker. */
export function SignaturesPage() {
  const { t, lang } = useI18n();
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('nav.signatures'));

  const copySignLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sign/${token}`);
      pushToast(t('sig.linkCopied'), 'success');
    } catch {
      pushToast(t('common.error'), 'error');
    }
  };
  const isMobile = useMediaQuery('(max-width: 700px)');
  const { data, loading, error, reload } = useAsync((signal) => signaturesApi.list(signal), []);
  const rows = data ?? [];
  const [selected, setSelected] = useState<SignatureRequest | null>(null);

  return (
    <div className={styles.page}>
      <TopBar title={t('sig.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('sig.title')}</h1>
            <p className={styles.pageSub}>{t('sig.sub')}</p>
          </div>

          {loading ? (
            <SkeletonRows rows={5} height={52} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <EmptyState icon="esign" title={t('sig.empty')} body={t('sig.emptyBody')} />
          ) : isMobile ? (
            <div className={styles.rowCards}>
              {rows.map((s) => {
                const signed = s.recipients.filter((r) => r.signed).length;
                return (
                  <div key={s.id} className={styles.rowCard} onClick={() => setSelected(s)}>
                    <div className={styles.rowCardHead}>
                      <div className={styles.docCellIcon}>
                        <Icon name="esign" size={16} />
                      </div>
                      <div className={styles.docCellName} style={{ flex: 1, minWidth: 0 }}>{s.documentName}</div>
                    </div>
                    <div className={styles.rowCardBadges}>
                      <Badge color={STATUS_TONE[s.status]} plain>{t(`sigstatus.${s.status}`)}</Badge>
                    </div>
                    <div className={styles.rowCardMeta}>
                      <span>{t('sig.signed', { a: signed, b: s.recipients.length })}</span>
                      <span>{formatDate(s.sentAt, locale)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>{t('sig.col.document')}</th>
                    <th className={styles.th}>{t('sig.col.status')}</th>
                    <th className={`${styles.th} ${styles.hideSm}`}>{t('sig.col.recipients')}</th>
                    <th className={`${styles.th} ${styles.hideSm}`}>{t('sig.col.sent')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const signed = s.recipients.filter((r) => r.signed).length;
                    return (
                      <tr key={s.id} className={styles.tr} onClick={() => setSelected(s)}>
                        <td className={styles.td}>
                          <div className={styles.docCell}>
                            <div className={styles.docCellIcon}>
                              <Icon name="esign" size={16} />
                            </div>
                            <div className={styles.docCellName}>{s.documentName}</div>
                          </div>
                        </td>
                        <td className={styles.td}>
                          <Badge color={STATUS_TONE[s.status]} plain>{t(`sigstatus.${s.status}`)}</Badge>
                        </td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>
                          {t('sig.signed', { a: signed, b: s.recipients.length })}
                        </td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.mono}`}>{formatDate(s.sentAt, locale)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={selected !== null}
        title={t('sig.detailTitle')}
        onClose={() => setSelected(null)}
        maxWidth={520}
      >
        {selected ? (
          <div>
            <div className={styles.sigDetailHead}>
              <div className={styles.docCellIcon}>
                <Icon name="esign" size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={styles.docCellName}>{selected.documentName}</div>
                <div className={styles.sigDetailMeta}>
                  {t('sig.col.sent')}: {formatDateFull(selected.sentAt, locale)}
                </div>
              </div>
              <Badge color={STATUS_TONE[selected.status]} plain>
                {t(`sigstatus.${selected.status}`)}
              </Badge>
            </div>

            <div className={styles.sigDetailLabel}>
              {t('sig.col.recipients')} · {selected.recipients.filter((r) => r.signed).length}/
              {selected.recipients.length}
            </div>
            <div className={styles.sigRecipients}>
              {selected.recipients.map((r, i) => (
                <div key={i} className={styles.sigRecipient}>
                  <span
                    className={styles.sigRecipientDot}
                    style={{ background: r.signed ? 'var(--sev-low)' : 'var(--sev-med)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={styles.sigRecipientName}>{r.name}</div>
                    <div className={styles.sigRecipientEmail}>{r.email}</div>
                  </div>
                  <span
                    className={styles.sigRecipientStatus}
                    style={{ color: r.signed ? 'var(--sev-low)' : 'var(--dim)' }}
                  >
                    {r.signed ? t('sig.signedYes') : t('sig.waiting')}
                  </span>
                  {!r.signed && r.token ? (
                    <IconButton
                      icon="docs"
                      label={t('sig.copyLink')}
                      size="sm"
                      iconSize={14}
                      onClick={() => void copySignLink(r.token as string)}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            <p className={styles.sigDetailHint}>{t('sig.copyHint')}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
