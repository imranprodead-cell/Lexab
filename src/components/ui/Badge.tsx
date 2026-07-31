import type { RiskLevel } from '@/types/domain';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ui.module.css';

/** Map a severity / risk / status keyword to its themed colour. */
export function toneColor(tone: string): string {
  switch (tone) {
    case 'High':
      return 'var(--sev-high)';
    case 'Medium':
    case 'Elevated':
      return 'var(--sev-med)';
    case 'Low':
    case 'ok':
    case 'success':
      return 'var(--sev-low)';
    case 'accent':
      return 'var(--accent)';
    default:
      return 'var(--dim)';
  }
}

interface BadgeProps {
  children: React.ReactNode;
  /** A colour keyword (High/Medium/Low/Elevated/accent) or a raw CSS colour. */
  color?: string;
  filled?: boolean;
  /** Frameless variant: coloured dot + coloured label-face text, no box around it. */
  plain?: boolean;
}

export function Badge({ children, color = 'var(--dim)', filled = false, plain = false }: BadgeProps) {
  const c = color.startsWith('var') || color.startsWith('#') || color.startsWith('oklch')
    ? color
    : toneColor(color);

  if (plain) {
    return (
      <span className={styles.badgePlain} style={{ color: c }}>
        <span className={styles.badgeDot} />
        {children}
      </span>
    );
  }

  // Цвет статуса задаётся только через color: подложка/точка берут currentColor.
  return (
    <span className={`${styles.badge} ${filled ? styles.badgeFilled : ''}`} style={{ color: c }}>
      <span className={styles.badgeDot} />
      {children}
    </span>
  );
}

export const RiskBadge = ({ risk, plain }: { risk: RiskLevel; plain?: boolean }) => {
  const { t } = useI18n();
  return <Badge color={risk} plain={plain}>{t(`risk.${risk}`)}</Badge>;
};
