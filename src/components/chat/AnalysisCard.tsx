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
}

/** Animated progress card shown while (and after) the contract is analyzed. */
export function AnalysisCard({ steps, activeStep, done }: AnalysisCardProps) {
  const { t } = useI18n();
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
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
    </GlassCard>
  );
}
