import { useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import { Badge, toneColor } from '@/components/ui/Badge';
import { CitationLine } from '@/components/ui/VerifiedBadge';
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
  /** Open the workspace and jump to the clause fixed by this finding's redline. */
  onOpenFinding: (redlineId: string) => void;
  /** Send one of the suggested document questions to the chat. */
  onAsk: (question: string) => void;
  /** "Other…": the user types their own question in the composer. */
  onAskCustom: () => void;
}

/** Post-analysis report: streaming summary, risk gauge, top findings, actions. */
export function SummaryCard({ analysis, onOpenWorkspace, onOpenFinding, onAsk, onAskCustom }: SummaryCardProps) {
  const { t } = useI18n();
  // onceKey = analysis id: the typewriter runs only the first time this
  // analysis is shown — reopening the chat renders the summary instantly.
  const { visible } = useStreamingText(analysis.summary, 2, 16, analysis.id);

  // "Ask a question" opens a picker with questions tailored to THIS document
  // (built from its top findings) instead of firing a canned message.
  const [askOpen, setAskOpen] = useState(false);
  const askRef = useDismissable<HTMLDivElement>(() => setAskOpen(false), askOpen);
  const questions = [
    ...analysis.findings.slice(0, 2).map((f) => t('chat.ask.explain', { title: f.title })),
    t('chat.ask.fix'),
    t('chat.ask.next'),
  ];

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
            const clickable = Boolean(f.redlineId);
            return (
              <div
                key={f.id}
                className={`${styles.finding} ${clickable ? styles.findingClickable : ''}`}
                {...(clickable
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      title: t('ws.jumpToClause'),
                      onClick: () => onOpenFinding(f.redlineId as string),
                      onKeyDown: (e: KeyboardEvent) => {
                        // Только Enter/Space на САМОЙ карточке: клавиатурная активация
                        // вложенных кнопок («Текст нормы», ссылка на источник)
                        // всплывает сюда и не должна открывать рабочую область.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenFinding(f.redlineId as string);
                        }
                      },
                    }
                  : {})}
              >
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
                  <CitationLine finding={f} />
                </div>
                {clickable ? <Icon name="chevron" size={14} color="var(--dim)" /> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="primary" icon="layout" iconRight="chevron" onClick={onOpenWorkspace}>
          {t('analysis.openWorkspace')}
        </Button>
        <div className={styles.askWrap} ref={askRef}>
          <Button variant="secondary" onClick={() => setAskOpen((v) => !v)}>
            {t('chat.sum.followUp')}
          </Button>
          {askOpen ? (
            <div className={styles.askMenu} role="menu">
              {questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="menuitem"
                  className={styles.askItem}
                  onClick={() => {
                    setAskOpen(false);
                    onAsk(q);
                  }}
                >
                  {q}
                </button>
              ))}
              <div className={styles.askDivider} />
              <button
                type="button"
                role="menuitem"
                className={`${styles.askItem} ${styles.askItemOther}`}
                onClick={() => {
                  setAskOpen(false);
                  onAskCustom();
                }}
              >
                <Icon name="pen" size={15} />
                {t('chat.ask.other')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}
