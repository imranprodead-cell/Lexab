import { Icon } from '@/components/icons/Icon';
import styles from './ui.module.css';

/** AI brand mark — gradient diamond used as the assistant avatar. */
export function Avatar({ size = 30 }: { size?: number }) {
  return (
    <div className={styles.avatar} style={{ width: size, height: size }}>
      <Icon name="diamond" size={size * 0.5} color="var(--on-accent)" strokeWidth={2.2} />
    </div>
  );
}

/** User initials chip shown in the rail footer, or a photo if one is set. */
export function InitialsAvatar({ initials, size = 26, src }: { initials: string; size?: number; src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={initials}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flexShrink: 0,
        background: 'linear-gradient(135deg,#3a3a46,#22222a)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.46,
        fontWeight: 600,
        color: 'var(--dim)',
      }}
    >
      {initials}
    </div>
  );
}
