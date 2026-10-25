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

/** Смысл цвета отметки: риск/важность или исход (готово, отклонено). */
type BadgeTone = 'neutral' | 'low' | 'elevated' | 'high';

/** Ключевое слово или цвет темы → один из четырёх сдержанных тонов. Всё, что не
 *  несёт смысла «хорошо / внимание / плохо» (в работе, роли, счётчики), —
 *  нейтральное: цветом выделяется только то, что важно заметить. */
function badgeTone(color: string | undefined): BadgeTone {
  switch (color) {
    case 'High':
    case 'var(--sev-high)':
    case 'var(--danger)':
      return 'high';
    case 'Elevated':
    case 'Medium':
    case 'var(--sev-med)':
    case 'var(--warn)':
      return 'elevated';
    case 'Low':
    case 'ok':
    case 'success':
    case 'var(--sev-low)':
    case 'var(--ok)':
      return 'low';
    default:
      return 'neutral';
  }
}

interface BadgeProps {
  children: React.ReactNode;
  /** Ключевое слово (High/Elevated/Medium/Low) или цвет темы (var(--sev-…)); без него — нейтральная. */
  color?: string;
}

/**
 * Отметка статуса / риска: сдержанная «таблетка» в обычном регистре, без
 * точки (эталон: Full Compliance / Partial / Non-Compliant). Один стиль на
 * весь сайт — в «Документах», проектах, подписях, массовом разборе и т. д.
 */
export function Badge({ children, color }: BadgeProps) {
  return (
    <span className={styles.badgeSoft} data-tone={badgeTone(color)}>
      {children}
    </span>
  );
}

export const RiskBadge = ({ risk }: { risk: RiskLevel }) => {
  const { t } = useI18n();
  return <Badge color={risk}>{t(`risk.${risk}`)}</Badge>;
};
