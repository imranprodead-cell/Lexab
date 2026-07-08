import styles from './ui.module.css';

export function Spinner({ size = 20 }: { size?: number }) {
  return <div className={styles.spinner} style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}
