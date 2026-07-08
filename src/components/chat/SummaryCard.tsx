import { Icon } from '@/components/icons/Icon';
import { Badge, toneColor } from '@/components/ui/Badge';
import { CitationChip } from '@/components/ui/CitationChip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { useStreamingText } from '@/hooks/useStreamingText';
import type { AnalysisResult } from '@/types/domain';
import { RiskGauge } from './RiskGauge';
import styles from './chat.module.css';

interface SummaryCardProps {
  analysis: AnalysisResult;
  onOpenWorkspace: () => void;
  onFollowUp: () => void;
}

/** Post-analysis report: streaming summary, risk gauge, top findings, actions. */
export function SummaryCard({ analysis, onOpenWorkspace, onFollowUp }: SummaryCardProps) {
  const { visible, done } = useStreamingText(analysis.summary);

  return (
    <GlassCard className={styles.summary}>
      <div className={styles.summaryTop}>
        <div className={styles.summaryMain}>
          <div className={styles.summaryMeta}>
            <Badge color={analysis.riskLevel}>{analysis.riskLevel} risk</Badge>
            <span className={styles.summaryMetaText}>
              {analysis.findings.length} critical findings · {analysis.clausesReviewed} clauses reviewed
            </span>
          </div>
          <p className={styles.summaryText}>
            {visible}
            {!done ? <span className={styles.cursor} /> : null}
          </p>
        </div>
        <RiskGauge score={analysis.riskScore} />
      </div>

      <div className={styles.findings}>
        <div className={styles.findingsLabel}>Top {analysis.findings.length} critical findings</div>
        <div className={styles.findingList}>
          {analysis.findings.map((f) => {
            const color = toneColor(f.severity);
            return (
              <div key={f.id} className={styles.finding}>
                <div
                  className={styles.findingIcon}
                  style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                >
                  <Icon name="alert" size={15} />
                </div>
                <div className={styles.findingMain}>
                  <div className={styles.findingHead}>
                    <span className={styles.findingTitle}>{f.title}</span>
                    <Badge color={f.severity}>{f.severity}</Badge>
                  </div>
                  <CitationChip citation={f.citation} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="primary" icon="layout" iconRight="chevron" onClick={onOpenWorkspace}>
          Open workspace
        </Button>
        <Button variant="secondary" onClick={onFollowUp}>
          Ask a follow-up
        </Button>
      </div>
    </GlassCard>
  );
}
