import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import type { Finding } from '@/types/domain';
import { CitationChip } from './CitationChip';
import styles from './ui.module.css';

/**
 * Citation-verification mark shown next to a finding's citation:
 * green check when the citation resolved against the statute corpus,
 * muted note when validation could not confirm the source, nothing when
 * the analysis predates RAG (no verification data at all).
 */
export function VerifiedBadge({ finding }: { finding: Pick<Finding, 'unitId' | 'unverified'> }) {
  const { t } = useI18n();
  if (finding.unverified) {
    return (
      <span className={`${styles.verify} ${styles.verifyWarn}`}>
        <Icon name="alert" size={12} />
        {t('finding.unverified')}
      </span>
    );
  }
  if (finding.unitId) {
    return (
      <span className={`${styles.verify} ${styles.verifyOk}`}>
        <Icon name="check" size={12} />
        {t('finding.verified')}
      </span>
    );
  }
  return null;
}

/** Citation chip + verification mark on one wrapping line. */
export function CitationLine({ finding }: { finding: Pick<Finding, 'citation' | 'unitId' | 'unverified'> }) {
  return (
    <span className={styles.citeRow}>
      <CitationChip citation={finding.citation} />
      <VerifiedBadge finding={finding} />
    </span>
  );
}
