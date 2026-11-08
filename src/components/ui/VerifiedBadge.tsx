import { useEffect, useState, type MouseEvent } from 'react';
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
export function VerifiedBadge({ finding, pending = false }: { finding: Pick<Finding, 'unitId' | 'unverified'>; pending?: boolean }) {
  const { t } = useI18n();
  // Агент ещё дочинивает ссылку в фоне — не пугаем «не подтверждён» раньше времени.
  if (finding.unverified && pending) {
    return (
      <span className={`${styles.verify} ${styles.verifyPending}`} title={t('finding.checking')}>
        <Icon name="clock" size={12} />
        <span className={styles.verifyText}>{t('finding.checking')}</span>
      </span>
    );
  }
  if (finding.unverified) {
    return (
      <span className={`${styles.verify} ${styles.verifyWarn}`} title={t('finding.unverified')}>
        <Icon name="alert" size={12} />
        <span className={styles.verifyText}>{t('finding.unverified')}</span>
      </span>
    );
  }
  if (finding.unitId) {
    return (
      <span className={`${styles.verify} ${styles.verifyOk}`} title={t('finding.verified')}>
        <Icon name="check" size={12} />
        <span className={styles.verifyText}>{t('finding.verified')}</span>
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
    <span className={`${styles.verify} ${styles.verifyDeviation}`} title={t('playbooks.deviationBadge')}>
      <Icon name="flag" size={12} />
      <span className={styles.verifyText}>{t('playbooks.deviationBadge')}</span>
    </span>
  );
}

/** Citation chip + verification mark + playbook-deviation mark on one wrapping line. */
export function CitationLine({
  finding,
  pending = false,
}: {
  finding: Pick<Finding, 'citation' | 'unitId' | 'unverified' | 'playbookDeviation'>;
  /** Ссылки разбора ещё дочиниваются в фоне (analysis.repairPending). */
  pending?: boolean;
}) {
  return (
    <span className={styles.citeRow}>
      <CitationChip citation={finding.citation} />
      <VerifiedBadge finding={finding} pending={pending} />
      <PlaybookDeviationBadge finding={finding} />
      {finding.unitId && !finding.unverified ? <LawTextToggle unitId={finding.unitId} /> : null}
    </span>
  );
}

/**
 * Текст нормы из официального корпуса (со ссылкой на первоисточник и датой
 * снимка). Текст берётся ТОЛЬКО из базы законов, никогда не генерируется.
 */
export function LawTextBox({ unitId }: { unitId: string }) {
  const { t, lang } = useI18n();
  const [unit, setUnit] = useState<LawUnit | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUnit(null);
    setFailed(false);
    lawApi
      .unit(unitId)
      .then((u) => {
        if (alive) setUnit(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [unitId]);

  return (
    <span className={styles.lawBox} dir="auto" onClick={(e) => e.stopPropagation()}>
      {failed ? (
        <span className={styles.lawMeta}>{t('law.failed')}</span>
      ) : unit ? (
        <>
          <span className={styles.lawBreadcrumb}>{unit.breadcrumb}</span>
          <span className={styles.lawText}>{unit.text}</span>
          <span className={styles.lawMeta}>
            {unit.officialUrl || unit.sourceUrl ? (
              <a href={(unit.officialUrl || unit.sourceUrl) as string} target="_blank" rel="noopener noreferrer">
                {t('law.source')}
              </a>
            ) : null}
            {unit.retrievedAt
              ? ` · ${t('law.retrieved')} ${new Date(unit.retrievedAt).toLocaleDateString(localeFor(lang))}`
              : null}
          </span>
        </>
      ) : (
        <Spinner size={14} />
      )}
    </span>
  );
}

/**
 * «Текст нормы» — раскрывает под ссылкой САМ текст статьи из официального
 * корпуса. Превращает бейдж «Проверено» из слова в доказательство.
 * openSignal — внешняя команда «раскрыть» (номер источника нажали в ответе).
 */
export function LawTextToggle({ unitId, openSignal }: { unitId: string; openSignal?: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  const toggle = (e: MouseEvent) => {
    // Карточка находки сама кликабельна (открывает рабочую область / якорит
    // документ) — клик по переключателю не должен до неё всплывать.
    e.stopPropagation();
    setOpen((v) => !v);
  };

  return (
    <>
      <button type="button" className={styles.lawToggle} onClick={toggle} aria-expanded={open}>
        <Icon name="chevron" size={12} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease' }} />
        {t(open ? 'law.hide' : 'law.show')}
      </button>
      {open ? <LawTextBox unitId={unitId} /> : null}
    </>
  );
}
