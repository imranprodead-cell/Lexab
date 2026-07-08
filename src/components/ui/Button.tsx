import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import styles from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  ghost: styles.btnGhost,
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const iconColor = variant === 'primary' ? 'var(--on-accent)' : 'currentColor';
  const iconSize = size === 'sm' ? 15 : 17;
  return (
    <button
      className={`${styles.btn} ${VARIANT_CLASS[variant]} ${size === 'sm' ? styles.btnSm : ''} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} color={iconColor} strokeWidth={1.9} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={iconSize} color={iconColor} strokeWidth={2} /> : null}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'md' | 'sm';
  iconSize?: number;
  style?: CSSProperties;
}

export function IconButton({ icon, label, size = 'md', iconSize = 19, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`${styles.iconBtn} ${size === 'sm' ? styles.iconBtnSm : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
