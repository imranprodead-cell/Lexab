import { FLAG_OBJECT_POSITION, flagUrl } from '@/data/countries';
import styles from './layout.module.css';

/** Circular country flag image, cropped so each emblem stays centered. */
export function Flag({ code, size = 28 }: { code: string; size?: number }) {
  return (
    <img
      src={flagUrl(code)}
      alt={code}
      loading="lazy"
      width={size}
      height={size}
      className={styles.flag}
      style={{ width: size, height: size, objectPosition: FLAG_OBJECT_POSITION[code] ?? 'center' }}
    />
  );
}
