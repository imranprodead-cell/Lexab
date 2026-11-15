import { useId, useState, type FormEvent } from 'react';
import { teamApi } from '@/api';
import { Button } from '@/components/ui/Button';
import { useAsync } from '@/hooks/useAsync';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT, type UxT } from '@/i18n/uxMessages';
import type { FindingDecision } from '@/lib/findingDecisions';
import { useUIStore } from '@/store/useUIStore';
import { useDateLabel, useMyName } from './uxHooks';
import styles from './ux.module.css';

/** Плашка статуса находки — одна и та же в списке, шапке и под карточкой. */
export function DecisionChip({ decision }: { decision?: FindingDecision | null }) {
  const u = useUxT();
  return <span {...decisionChipProps(decision, u)} />;
}

function decisionChipProps(d: FindingDecision | null | undefined, u: UxT) {
  if (!d) return { className: `${styles.chip} ${styles.chipBlue}`, children: u('dec.wait') };
  if (d.kind === 'fixed') return { className: `${styles.chip} ${styles.chipLow}`, children: u('dec.fixed') };
  if (d.kind === 'ok') return { className: `${styles.chip} ${styles.chipGrey}`, children: u('dec.ok') };
  return { className: `${styles.chip} ${styles.chipMed}`, children: u('dec.atColleague') };
}

/**
 * Решение по находке: «Исправлено», «Не проблема» или «Передать коллеге».
 * Под решением — имя и дата. Тестовая версия хранит решения в браузере
 * (lib/findingDecisions); в рабочей они уедут в базу и станут видны команде.
 */
export function DecisionBar({
  decision,
  onDecide,
  canEdit = true,
}: {
  decision?: FindingDecision | null;
  /** Сохранение на сервере: ошибка откатывает решение на экране (тост здесь). */
  onDecide: (d: FindingDecision | null) => void | Promise<void>;
  canEdit?: boolean;
}) {
  const u = useUxT();
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const save = (d: FindingDecision | null, okMessage: string) =>
    Promise.resolve(onDecide(d)).then(
      () => pushToast(okMessage, 'default'),
      (err: unknown) => pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error'),
    );
  const me = useMyName();
  const dateLabel = useDateLabel();
  const [assignOpen, setAssignOpen] = useState(false);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const ids = useId();

  // Подсказки «кому» — участники команды, если она есть (на Free — 402, молча без них).
  const { data: members } = useAsync(
    async (signal) => (assignOpen ? (await teamApi.members(signal).catch(() => [])).map((m) => m.name).filter(Boolean) : []),
    [assignOpen],
  );

  const decide = (kind: 'fixed' | 'ok') => {
    setAssignOpen(false);
    void save({ kind, who: me, at: new Date().toISOString() }, u('dec.toastSet', { status: u(kind === 'fixed' ? 'dec.fixed' : 'dec.ok') }));
  };

  const submitAssign = (e: FormEvent) => {
    e.preventDefault();
    const who = to.trim();
    if (!who) {
      pushToast(u('dec.needWho'), 'error');
      return;
    }
    setAssignOpen(false);
    setTo('');
    setNote('');
    void save({ kind: 'assigned', who: me, at: new Date().toISOString(), to: who, note: note.trim() || undefined }, u('dec.toastAssigned', { to: who }));
  };

  const undo = () => {
    void save(null, u('dec.toastUndo'));
  };

  const buttons = canEdit ? (
    <div className={styles.row}>
      <Button variant="secondary" size="sm" icon="check" onClick={() => decide('fixed')}>
        {u('dec.fixed')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => decide('ok')}>
        {u('dec.ok')}
      </Button>
      {!decision ? (
        <Button variant="ghost" size="sm" icon="arrowRight" onClick={() => setAssignOpen((v) => !v)} aria-expanded={assignOpen}>
          {u('dec.assign')}
        </Button>
      ) : null}
    </div>
  ) : null;

  if (!decision) {
    return (
      <div className={styles.decision}>
        <span className={styles.lbl}>{u('dec.your')}</span>
        {buttons}
        {assignOpen ? (
          <form className={styles.assign} onSubmit={submitAssign}>
            <label htmlFor={`${ids}-to`}>{u('dec.to')}</label>
            <input
              id={`${ids}-to`}
              className={styles.input}
              list={`${ids}-people`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={u('dec.toPh')}
              autoFocus
            />
            <datalist id={`${ids}-people`}>
              {(members ?? []).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <label htmlFor={`${ids}-note`}>{u('dec.note')}</label>
            <textarea id={`${ids}-note`} className={styles.input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={u('dec.notePh')} />
            <div className={styles.row}>
              <Button variant="primary" size="sm" type="submit">
                {u('dec.send')}
              </Button>
              <button type="button" className={styles.link} onClick={() => setAssignOpen(false)}>
                {u('dec.cancel')}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    );
  }

  if (decision.kind === 'assigned') {
    return (
      <div className={styles.decision}>
        <div className={styles.decRec}>
          <span className={`${styles.chip} ${styles.chipMed}`}>
            {u('dec.assigned', { to: decision.to ?? '' })}
          </span>
          <span className={styles.decWho}>
            {u('dec.by', { who: decision.who })} <span className={styles.muted}>{dateLabel(decision.at)}</span>
          </span>
        </div>
        {decision.note ? <p className={styles.decNote} dir="auto">«{decision.note}»</p> : null}
        <span className={`${styles.muted} ${styles.small}`}>{u('dec.colleagueDecides')}</span>
        <div className={styles.row}>
          {buttons}
          {canEdit ? (
            <button type="button" className={styles.link} onClick={undo}>
              {u('dec.recall')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.decision}>
      <div className={styles.decRec}>
        <DecisionChip decision={decision} />
        <span className={styles.decWho}>
          <b>{decision.who}</b> <span className={styles.muted}>{dateLabel(decision.at)}</span>
        </span>
      </div>
      {decision.note ? <p className={styles.decNote} dir="auto">«{decision.note}»</p> : null}
      {canEdit ? (
        <button type="button" className={styles.link} onClick={undo} style={{ alignSelf: 'flex-start' }}>
          {u('dec.change')}
        </button>
      ) : null}
    </div>
  );
}
