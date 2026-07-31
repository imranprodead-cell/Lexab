import styles from './chat.module.css';

interface RiskGaugeProps {
  score: number; // 0..100
}

/** Radial risk gauge — accent→amber sweep proportional to the score. */
export function RiskGauge({ score }: RiskGaugeProps) {
  const R = 52;
  const circ = 2 * Math.PI * R;
  const offset = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  const gradientId = 'lx-gauge-gradient';

  return (
    <div className={styles.gaugeWrap}>
      <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
        <svg width={132} height={132} viewBox="0 0 132 132" style={{ transform: 'rotate(-90deg)' }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--chart-accent)" />
              <stop offset="100%" stopColor="var(--sev-med)" />
            </linearGradient>
          </defs>
          <circle cx={66} cy={66} r={R} fill="none" stroke="var(--border)" strokeWidth={9} />
          <circle
            cx={66}
            cy={66}
            r={R}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 11, color: 'var(--mut)', fontFamily: 'var(--font-label)', marginTop: 2 }}>/ 100</div>
        </div>
      </div>
      <div className={styles.gaugeLabel}>risk score</div>
    </div>
  );
}
