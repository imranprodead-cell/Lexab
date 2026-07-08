import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import styles from './chat.module.css';

interface AnalysisCardProps {
  steps: string[];
  /** -1 none, 0..n-1 in progress, n = complete. */
  activeStep: number;
  done: boolean;
}

/** Animated progress card shown while (and after) the contract is analyzed. */
export function AnalysisCard({ steps, activeStep, done }: AnalysisCardProps) {
  const pct = done ? 100 : Math.max(4, (activeStep / steps.length) * 100);

  return (
    <GlassCard className={styles.card}>
      <div className={styles.cardHead} style={{ marginBottom: done ? 12 : 14 }}>
        <span className={styles.cardTitle}>{done ? 'Analysis complete' : 'Analyzing contract'}</span>
        {done ? <Badge color="Low">Complete</Badge> : <Badge color="Elevated">Working</Badge>}
      </div>

      {done ? (
        <div className={styles.doneList}>
          {steps.map((label) => (
            <div key={label} className={styles.doneItem}>
              <span className={styles.doneCheck}>
                <Icon name="check" size={10} strokeWidth={2.6} />
              </span>
              {label}
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
                <span
                  className={`${styles.stepLabel} ${state === 'pending' ? styles.stepLabelPending : ''} ${
                    state === 'active' ? styles.stepLabelActive : ''
                  }`}
                >
                  {label}
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
