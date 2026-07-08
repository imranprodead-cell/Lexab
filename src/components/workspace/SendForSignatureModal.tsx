import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { signaturesApi } from '@/api';
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
  const [recipients, setRecipients] = useState<Recipient[]>([{ name: '', email: '' }]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const update = (index: number, patch: Partial<Recipient>) => {
    setRecipients((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const validate = (): boolean => {
    const next: Record<number, string> = {};
    recipients.forEach((r, i) => {
      if (!r.name.trim() || !r.email.trim()) next[i] = 'Name and email are required.';
      else if (!EMAIL_RE.test(r.email.trim())) next[i] = 'Enter a valid email address.';
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
    } catch {
      setSubmitting(false);
      setErrors({ 0: 'Could not send request. Please try again.' });
    }
  };

  return (
    <Modal
      open={open}
      title="Send for e-signature"
      onClose={onClose}
      maxWidth={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send request'}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--dim)' }}>
        Recipients will receive <strong style={{ color: 'var(--text)' }}>{documentName}</strong> with the accepted
        redlines applied, in signing order.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {recipients.map((r, i) => (
          <div key={i} className={styles.recipientRow}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <TextField
                placeholder="Full name"
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
                label="Remove recipient"
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
        Add recipient
      </button>
    </Modal>
  );
}
