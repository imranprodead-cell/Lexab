import { Icon, type IconName } from '@/components/icons/Icon';
import { Badge, toneColor } from '@/components/ui/Badge';
import { CitationChip } from '@/components/ui/CitationChip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { useStreamingText } from '@/hooks/useStreamingText';
import { useI18n } from '@/i18n/I18nProvider';
import type { AnalysisResult } from '@/types/domain';
import { RiskGauge } from './RiskGauge';
import styles from './chat.module.css';

/** Same severity → icon mapping as the Analytics page legend. */
const SEVERITY_ICON: Record<string, IconName> = {
  High: 'alert',
  Medium: 'shield',
  Low: 'check',
};

interface SummaryCardProps {
  analysis: AnalysisResult;
  onOpenWorkspace: () => void;
  onFollowUp: () => void;
}

/** Post-analysis report: streaming summary, risk gauge, top findings, actions. */
export function SummaryCard({ analysis, onOpenWorkspace, onFollowUp }: SummaryCardProps) {
  const { t } = useI18n();
  const { visible } = useStreamingText(analysis.summary);

  return (
    <GlassCard className={styles.summary}>
      <div className={styles.summaryTop}>
        <div className={styles.summaryMain}>
          <div className={styles.summaryMeta}>
            <Badge color={analysis.riskLevel}>{t(`risk.${analysis.riskLevel}`)}</Badge>
            <span className={styles.summaryMetaText}>
              {t('chat.sum.meta', { n: analysis.findings.length, m: analysis.clausesReviewed })}
            </span>
          </div>
          <p className={styles.summaryText}>{visible}</p>
        </div>
        <RiskGauge score={analysis.riskScore} />
      </div>

      <div className={styles.findings}>
        <div className={styles.findingsLabel}>{t('chat.sum.top', { n: analysis.findings.length })}</div>
        <div className={styles.findingList}>
          {analysis.findings.map((f) => {
            const color = toneColor(f.severity);
            return (
              <div key={f.id} className={styles.finding}>
                <div
                  className={styles.findingIcon}
                  style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                >
                  <Icon name={SEVERITY_ICON[f.severity] ?? 'alert'} size={15} />
                </div>
                <div className={styles.findingMain}>
                  <div className={styles.findingHead}>
                    <span className={styles.findingTitle}>{f.title}</span>
                    <Badge color={f.severity}>{t(`sev.${f.severity}`)}</Badge>
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
          {t('analysis.openWorkspace')}
        </Button>
        <Button variant="secondary" onClick={onFollowUp}>
          {t('chat.sum.followUp')}
        </Button>
      </div>
    </GlassCard>
  );
}
