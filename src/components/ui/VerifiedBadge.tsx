import { useState, type MouseEvent } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { lawApi, type LawUnit } from '@/api/law.api';
import { localeFor } from '@/i18n/dates';
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

/**
 * Playbook-deviation mark: shown when the clause departs from an active team
 * playbook position. Sits next to the citation-verification badge.
 */
export function PlaybookDeviationBadge({ finding }: { finding: Pick<Finding, 'playbookDeviation'> }) {
  const { t } = useI18n();
  if (!finding.playbookDeviation) return null;
  return (
    <span className={`${styles.verify} ${styles.verifyDeviation}`}>
      <Icon name="flag" size={12} />
      {t('playbooks.deviationBadge')}
    </span>
  );
}

/** Citation chip + verification mark + playbook-deviation mark on one wrapping line. */
export function CitationLine({
  finding,
}: {
  finding: Pick<Finding, 'citation' | 'unitId' | 'unverified' | 'playbookDeviation'>;
}) {
  return (
    <span className={styles.citeRow}>
      <CitationChip citation={finding.citation} />
      <VerifiedBadge finding={finding} />
      <PlaybookDeviationBadge finding={finding} />
      {finding.unitId && !finding.unverified ? <LawTextToggle unitId={finding.unitId} /> : null}
    </span>
  );
}

/**
 * «Текст нормы» — раскрывает под находкой САМ текст статьи из официального
 * корпуса (со ссылкой на первоисточник и датой снимка). Превращает бейдж
 * «Проверено» из слова в доказательство. Текст берётся ТОЛЬКО из базы законов,
 * никогда не генерируется.
 */
function LawTextToggle({ unitId }: { unitId: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<LawUnit | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = (e: MouseEvent) => {
    // Карточка находки сама кликабельна (открывает рабочую область / якорит
    // документ) — клик по переключателю не должен до неё всплывать.
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (unit || busy) return;
    setBusy(true);
    setFailed(false);
    lawApi
      .unit(unitId)
      .then(setUnit)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button type="button" className={styles.lawToggle} onClick={toggle} aria-expanded={open}>
        <Icon name="chevron" size={12} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease' }} />
        {t(open ? 'law.hide' : 'law.show')}
      </button>
      {open ? (
        <span className={styles.lawBox} dir="auto" onClick={(e) => e.stopPropagation()}>
          {busy ? (
            <Spinner size={14} />
          ) : failed ? (
            <span className={styles.lawMeta}>{t('law.failed')}</span>
          ) : unit ? (
            <>
              <span className={styles.lawBreadcrumb}>{unit.breadcrumb}</span>
              <span className={styles.lawText}>{unit.text}</span>
              <span className={styles.lawMeta}>
                {unit.sourceUrl ? (
                  <a href={unit.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {t('law.source')}
                  </a>
                ) : null}
                {unit.retrievedAt
                  ? ` · ${t('law.retrieved')} ${new Date(unit.retrievedAt).toLocaleDateString(localeFor(lang))}`
                  : null}
              </span>
            </>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
