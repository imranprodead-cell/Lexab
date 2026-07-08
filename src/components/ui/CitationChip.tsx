import styles from './ui.module.css';

/** A monospace legal-citation chip (e.g. "Employment Rights Act 1996, s.86"). */
export function CitationChip({ citation }: { citation: string }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipMark} />
      {citation}
    </span>
  );
}
