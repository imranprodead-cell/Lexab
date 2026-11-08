import { useState } from 'react';
import { analysisApi } from '@/api/analysis.api';
import { contractsApi } from '@/api/contracts.api';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { apiErrorMessage } from '@/i18n/apiError';
import { extractActions, type EditProposal, type ReminderProposal } from '@/lib/editProposals';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import styles from './chat.module.css';

/**
 * Карточки правок, предложенных агентом: «Было → Станет» и кнопка «Принять».
 * Агент сам документ не меняет — правку вносит только нажатие пользователя
 * (POST /analysis/:id/redlines: сервер проверяет права и что пункт есть в
 * договоре). Повторное нажатие не создаёт дубль.
 */
export function EditProposalCards({ edits }: { edits: EditProposal[] }) {
  if (!edits.length) return null;
  return (
    <div className={styles.editCards}>
      {edits.map((e, i) => (
        <EditCard key={`${e.analysisId}:${i}:${e.delText.slice(0, 40)}`} edit={e} />
      ))}
    </div>
  );
}

function EditCard({ edit }: { edit: EditProposal }) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');

  const accept = async () => {
    if (state !== 'idle') return;
    setState('saving');
    try {
      await analysisApi.addRedline(edit.analysisId, edit.delText, edit.insText);
      setState('done');
      pushToast(t('edit.appliedToast'), 'success');
      void useChatStore.getState().refreshAnalysis(edit.analysisId);
    } catch (err) {
      setState('idle');
      pushToast(apiErrorMessage(err, t) || t('edit.error'), 'error');
    }
  };

  return (
    <div className={styles.editCard} role="group" aria-label={t('edit.title')}>
      <div className={styles.editHead}>
        <Icon name="doc" size={14} />
        <span>{t('edit.title')}</span>
      </div>
      <div className={styles.editBody}>
        <div className={styles.editLabel}>{t('edit.was')}</div>
        <div className={styles.editWas}>{edit.delText}</div>
        <div className={styles.editLabel}>{t('edit.now')}</div>
        <div className={styles.editNow}>{edit.insText.trim() ? edit.insText : <em>{t('edit.deleted')}</em>}</div>
        {edit.reason ? <div className={styles.editReason}>{edit.reason}</div> : null}
      </div>
      <div className={styles.editActions}>
        {state === 'done' ? (
          <span className={styles.editDone}>
            <Icon name="check" size={14} />
            {t('edit.applied')}
          </span>
        ) : (
          <Button size="sm" onClick={() => void accept()} disabled={state === 'saving'}>
            {state === 'saving' ? t('edit.accepting') : t('edit.accept')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** ДД.ММ.ГГГГ из ISO без сдвига часового пояса. */
const ruDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

/**
 * Карточка срока, предложенного агентом: что сделать, к какой дате и за
 * сколько дней напомнить на почту. «Добавить напоминание» кладёт срок в
 * «Сроки и обязательства» (POST /contracts/:id/obligations) — письмо придёт
 * на почту аккаунта. Без нажатия ничего не добавляется.
 */
function ReminderCard({ reminder }: { reminder: ReminderProposal }) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [remindOn, setRemindOn] = useState<string | null>(null);

  const add = async () => {
    if (state !== 'idle') return;
    setState('saving');
    try {
      const res = await contractsApi.addReminder(reminder.documentId, {
        text: reminder.text,
        dueDate: reminder.dueDate,
        remindDaysBefore: reminder.remindDaysBefore,
      });
      setRemindOn(res.remindOn);
      setState('done');
      pushToast(t('reminder.addedToast', { date: ruDate(res.remindOn) }), 'success');
    } catch (err) {
      setState('idle');
      pushToast(apiErrorMessage(err, t) || t('reminder.error'), 'error');
    }
  };

  return (
    <div className={styles.editCard} role="group" aria-label={t('reminder.title')}>
      <div className={styles.editHead}>
        <Icon name="calendar" size={14} />
        <span>{reminder.documentName ? t('reminder.titleFor', { name: reminder.documentName }) : t('reminder.title')}</span>
      </div>
      <div className={styles.editBody}>
        <div className={styles.editNow}>{reminder.text}</div>
        <div className={styles.editLabel}>{t('reminder.due', { date: ruDate(reminder.dueDate) })}</div>
        <div className={styles.editReason}>
          {reminder.remindDaysBefore > 0 ? t('reminder.emailBefore', { n: reminder.remindDaysBefore }) : t('reminder.emailOnDay')}
        </div>
      </div>
      <div className={styles.editActions}>
        {state === 'done' ? (
          <span className={styles.editDone}>
            <Icon name="check" size={14} />
            {t('reminder.added', { date: ruDate(remindOn ?? reminder.dueDate) })}
          </span>
        ) : (
          <Button size="sm" onClick={() => void add()} disabled={state === 'saving'}>
            {state === 'saving' ? t('reminder.adding') : t('reminder.add')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Все действия агента под ответом: правки пунктов и сроки с напоминанием. */
export function AgentActionCards({ text }: { text: string }) {
  const { edits, reminders } = extractActions(text);
  if (!edits.length && !reminders.length) return null;
  return (
    <>
      <EditProposalCards edits={edits} />
      {reminders.length ? (
        <div className={styles.editCards}>
          {reminders.map((r, i) => (
            <ReminderCard key={`${r.documentId}:${r.dueDate}:${i}`} reminder={r} />
          ))}
        </div>
      ) : null}
    </>
  );
}
