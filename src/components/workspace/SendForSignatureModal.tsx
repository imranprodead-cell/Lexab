import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { signaturesApi } from '@/api';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

interface Recipient {
  name: string;
  email: string;
}

interface SendForSignatureModalProps {
  open: boolean;
  documentName: string;
  onClose: () => void;
  onSent: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Modal to collect recipients and dispatch an e-signature request (validated). */
export function SendForSignatureModal({ open, documentName, onClose, onSent }: SendForSignatureModalProps) {
  const { t } = useI18n();
  const features = useFeatureFlags();
  const [recipients, setRecipients] = useState<Recipient[]>([{ name: '', email: '' }]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const update = (index: number, patch: Partial<Recipient>) => {
    setRecipients((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const validate = (): boolean => {
    const next: Record<number, string> = {};
    recipients.forEach((r, i) => {
      if (!r.name.trim() || !r.email.trim()) next[i] = t('sign.errRequired');
      else if (!EMAIL_RE.test(r.email.trim())) next[i] = t('sign.errEmail');
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signaturesApi.send({
        documentName,
        recipients: recipients.map((r) => ({ name: r.name.trim(), email: r.email.trim() })),
      });
      setSubmitting(false);
      setRecipients([{ name: '', email: '' }]);
      setErrors({});
      onSent();
    } catch (err) {
      setSubmitting(false);
      // Surface the server's own explanation (e.g. "E-signatures are available
      // on Pro/Business plans") instead of a generic "try again".
      setErrors({ 0: err instanceof Error && err.message ? err.message : t('sign.errSend') });
    }
  };

  // Раздел закрыт до подключения E-IMZO: заполнять форму и получать 503 в конце
  // хуже, чем сразу честно сказать «скоро» (аудит 2026-08-03).
  if (!features.esign) {
    return (
      <Modal
        open={open}
        title={t('sign.title')}
        onClose={onClose}
        maxWidth={480}
        footer={
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 0 4px', textAlign: 'center' }}>
          <Icon name="esign" size={28} />
          <strong style={{ fontSize: 15 }}>{t('sig.soon')}</strong>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)', maxWidth: 360 }}>{t('sig.soonBody')}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={t('sign.title')}
      onClose={onClose}
      maxWidth={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="send" onClick={submit} disabled={submitting}>
            {submitting ? t('sign.sending') : t('sign.send')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--dim)' }}>
        {t('sign.introA')}
        <strong style={{ color: 'var(--text)' }}>{documentName}</strong>
        {t('sign.introB')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {recipients.map((r, i) => (
          <div key={i} className={styles.recipientRow}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <TextField
                placeholder={t('sign.namePh')}
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
                error={errors[i] ? ' ' : null}
              />
              <TextField
                type="email"
                placeholder="name@company.com"
                value={r.email}
                onChange={(e) => update(i, { email: e.target.value })}
                error={errors[i] ?? null}
              />
            </div>
            {recipients.length > 1 ? (
              <IconButton
                icon="x"
                label={t('sign.remove')}
                size="sm"
                iconSize={15}
                className={styles.recipientRemove}
                onClick={() => setRecipients((rs) => rs.filter((_, idx) => idx !== i))}
              />
            ) : null}
          </div>
        ))}
      </div>

      <button
        className={styles.toolbarBtn}
        style={{ marginTop: 14, background: 'transparent' }}
        onClick={() => setRecipients((rs) => [...rs, { name: '', email: '' }])}
      >
        <Icon name="plus" size={15} />
        {t('sign.add')}
      </button>
    </Modal>
  );
}
