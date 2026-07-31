import styles from './ui.module.css';

/** Бренд-глиф Lexab из дизайн-эталона: буква «L», полупрозрачные «строки
 *  документа» и кружок-галочка «проверено». Цвет — через currentColor,
 *  поэтому знак сам адаптируется к теме и контексту. */
export function LogoMarkGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4v14.6h12.8" strokeWidth={3.2} />
      <g strokeWidth={2.1} opacity={0.38}>
        <path d="M10.8 6.4h8.6" />
        <path d="M10.8 9.6h6.6" />
        <path d="M10.8 12.8h2.6" />
      </g>
      <g strokeWidth={1}>
        <circle cx="17.6" cy="13.9" r="3.4" />
        <path d="m16 14 1.2 1.2 2.2-2.8" />
      </g>
    </svg>
  );
}

/** Знак на плашке (рамка + серая панель) — LogoMark эталона. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span className={styles.logoMark} style={{ width: size, height: size }}>
      <LogoMarkGlyph size={Math.round(size * 0.72)} />
    </span>
  );
}
