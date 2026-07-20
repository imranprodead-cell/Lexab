import { useEffect, useState } from 'react';
import { contractsApi } from '@/api';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { ContractObligation } from '@/types/domain';
import styles from './contracts.module.css';

/**
 * Checkbox list of a contract's obligations with optimistic toggling. The
 * click is always allowed — a permission refusal from the server (400) reverts
 * the checkbox and surfaces as a toast.
 */
export function ObligationList({ documentId, obligations }: { documentId: string; obligations: ContractObligation[] }) {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [items, setItems] = useState(obligations);
  const [savingId, setSavingId] = useState<string | null>(null);

  // A reload upstream hands in a fresh list — adopt it.
  useEffect(() => setItems(obligations), [obligations]);

  // Local calendar date (not UTC) — due dates are date-only strings.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const toggle = async (ob: ContractObligation) => {
    if (savingId) return;
    const next = !ob.done;
    setSavingId(ob.id);
    setItems((xs) => xs.map((x) => (x.id === ob.id ? { ...x, done: next } : x)));
    try {
      await contractsApi.setObligationDone(documentId, ob.id, next);
    } catch (err) {
      setItems((xs) => xs.map((x) => (x.id === ob.id ? { ...x, done: ob.done } : x)));
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <ul className={styles.obList}>
      {items.map((ob) => {
        const overdue = !ob.done && ob.dueDate !== null && ob.dueDate < today;
        return (
          <li key={ob.id} className={styles.obRow}>
            <input
              type="checkbox"
              className={styles.obCheck}
              checked={ob.done}
              disabled={savingId === ob.id}
              aria-label={ob.text}
              onChange={() => void toggle(ob)}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={`${styles.obText} ${ob.done ? styles.obTextDone : ''}`}>{ob.text}</div>
              {ob.responsible || ob.dueDate ? (
                <div className={styles.obMeta}>
                  {ob.responsible}
                  {ob.responsible && ob.dueDate ? ' · ' : ''}
                  {ob.dueDate ? (
                    <span className={overdue ? styles.obOverdue : undefined}>
                      {overdue ? `${t('contracts.overdue')} · ` : ''}
                      {t('contracts.due', { date: formatDate(ob.dueDate) })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
