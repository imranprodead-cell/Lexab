import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './chat.module.css';

interface AnalysisCardProps {
  steps: string[];
  /** -1 none, 0..n-1 in progress, n = complete. */
  activeStep: number;
  done: boolean;
  /** Когда начался разбор (мс) — карточка показывает бегущее время. */
  startedAt?: number | null;
  /** Кнопка «Отменить»; не передана — кнопки нет. */
  onCancel?: () => void;
}

/** «1 мин 20 с» / «45 с» — без библиотек и без лишних зависимостей. */
function formatElapsed(ms: number, secLabel: string, minLabel: string): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min ? `${min} ${minLabel} ${sec} ${secLabel}` : `${sec} ${secLabel}`;
}

/** Animated progress card shown while (and after) the contract is analyzed. */
export function AnalysisCard({ steps, activeStep, done, startedAt, onCancel }: AnalysisCardProps) {
  const { t } = useI18n();
  // Тикаем раз в секунду, пока идёт разбор: раньше индикатор замирал на 66% и
  // молчал минутами — человек не понимал, работает ли что-то (аудит 2026-08-03).
  const [now, setNow] = useState(() => Date.now());
  const running = !done && Boolean(startedAt);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const lastStepReached = activeStep >= steps.length - 1;
  const elapsed = startedAt ? now - startedAt : 0;
  // Пока идут расписанные шаги — привычная шкала. Дальше честнее показать
  // «работаю» бегущей полосой, чем врать процентами, которых мы не знаем.
  const pct = done ? 100 : Math.max(4, (activeStep / steps.length) * 100);
  // Step captions live in the dictionary; the array only sets the count.
  const stepLabel = (i: number) => t(`chat.an.step${i + 1}`);

  return (
    <GlassCard className={styles.card}>
      <div className={styles.cardHead} style={{ marginBottom: done ? 12 : 14 }}>
        <span className={styles.cardTitle}>{done ? t('chat.an.doneTitle') : t('chat.an.workingTitle')}</span>
        {done ? <Badge color="Low">{t('chat.an.badgeDone')}</Badge> : <Badge color="Elevated">{t('chat.an.badgeWork')}</Badge>}
      </div>

      {done ? (
        <div className={styles.doneList}>
          {steps.map((label, i) => (
            <div key={label} className={styles.doneItem}>
              <span className={styles.doneCheck}>
                <Icon name="check" size={10} strokeWidth={2.6} />
              </span>
              {stepLabel(i)}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.steps}>
          {steps.map((label, i) => {
            const state = i < activeStep ? 'done' : i === activeStep ? 'active' : 'pending';
            return (
              <div key={label} className={styles.stepRow}>
                {state === 'done' ? (
                  <span className={`${styles.stepIndicator} ${styles.stepDone}`}>
                    <Icon name="check" size={12} strokeWidth={2.4} />
                  </span>
                ) : state === 'active' ? (
                  <span className={`${styles.stepIndicator} ${styles.stepActive}`} />
                ) : (
                  <span className={`${styles.stepIndicator} ${styles.stepPending}`} />
                )}
                {/* key={state}: the label remounts with a soft fade when its
                    state flips — no mid-transition ghosting/overlap. */}
                <span
                  key={state}
                  className={`${styles.stepLabel} ${styles.stepLabelIn} ${state === 'pending' ? styles.stepLabelPending : ''} ${
                    state === 'active' ? styles.stepLabelActive : ''
                  }`}
                >
                  {stepLabel(i)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.progressTrack} style={{ marginTop: done ? 14 : 0 }}>
        <div
          className={`${styles.progressFill} ${running && lastStepReached ? styles.progressIndeterminate : ''}`}
          style={running && lastStepReached ? undefined : { width: `${pct}%` }}
        />
      </div>

      {running ? (
        <div className={styles.progressFoot}>
          <span className={styles.progressElapsed}>
            {t('chat.an.elapsed', { time: formatElapsed(elapsed, t('chat.an.sec'), t('chat.an.min')) })}
          </span>
          {onCancel ? (
            <button type="button" className={styles.progressCancel} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
