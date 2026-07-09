import { Avatar } from './Avatar';
import styles from './ui.module.css';

/** Brand mark wrapped in an infinite progress ring — shown while the AI works. */
export function LogoLoader({ size = 30 }: { size?: number }) {
  return (
    <span className={styles.logoLoader} style={{ width: size, height: size }} role="status">
      <span className={styles.logoLoaderRing} aria-hidden />
      <span className={styles.logoLoaderMark}>
        <Avatar size={size} />
      </span>
    </span>
  );
}
