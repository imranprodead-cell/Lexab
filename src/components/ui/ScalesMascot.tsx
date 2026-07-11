import styles from './mascot.module.css';

/**
 * Animated brand mascot: the scales of justice with a face — rocking beam,
 * bobbing head in a mortarboard with a swinging gold tassel, blinking eyes
 * and a judge's jabot. Shown while the app loads and while the AI thinks.
 */
export function ScalesMascot({ size = 96 }: { size?: number }) {
  const height = Math.round((size * 210) / 200);
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 200 210"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={styles.mascot}
      aria-hidden="true"
    >
      {/* base + vertical beam */}
      <rect x="74" y="158" width="52" height="7" rx="3.5" fill="var(--m-body)" />
      <rect x="86" y="150" width="28" height="10" rx="3" fill="var(--m-body)" />
      <rect x="96.5" y="80" width="7" height="74" rx="3.5" fill="var(--m-body)" />

      {/* head + cap + face (bobs) */}
      <g className={styles.bob}>
        <circle cx="100" cy="54" r="27" fill="var(--m-body)" />

        {/* mortarboard with thin gold trim */}
        <path d="M80 30 Q100 20 120 30 L120 34 Q100 26 80 34 Z" fill="var(--m-body)" />
        <path d="M80 30 Q100 20 120 30" stroke="var(--m-gold)" strokeWidth="1.6" fill="none" opacity="0.95" />
        <polygon points="100,8 132,22 100,36 68,22" fill="var(--m-body)" stroke="var(--m-gold)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="100" cy="22" r="3" fill="var(--m-gold)" />
        <g className={styles.tassel}>
          <path d="M100 22 Q126 24 128 30 L128 44" stroke="var(--m-gold)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <circle cx="128" cy="47" r="4" fill="var(--m-gold)" />
        </g>

        {/* strict brows */}
        <path d="M84 41.5 L95 40" stroke="var(--m-paper)" strokeWidth="3" strokeLinecap="round" />
        <path d="M116 41.5 L105 40" stroke="var(--m-paper)" strokeWidth="3" strokeLinecap="round" />

        {/* eyes (blink) */}
        <g className={styles.blink}>
          <circle cx="90" cy="50" r="4.4" fill="var(--m-paper)" />
          <circle cx="110" cy="50" r="4.4" fill="var(--m-paper)" />
        </g>

        {/* calm half-smile */}
        <path d="M90 61 Q100 67.5 110 61" stroke="var(--m-paper)" strokeWidth="3.8" strokeLinecap="round" fill="none" />
      </g>

      {/* balance beam + chains + documents + pans (rocks) */}
      <g className={styles.rock}>
        <rect x="44" y="88.5" width="112" height="7" rx="3.5" fill="var(--m-body)" />
        <rect x="47" y="89.8" width="106" height="1.7" rx="0.85" fill="var(--m-gold)" opacity="0.9" />
        <circle cx="100" cy="92" r="4.5" fill="var(--m-body)" stroke="var(--m-gold)" strokeWidth="1.6" />

        {/* left chains + documents */}
        <path d="M50 93 L40 121" stroke="var(--m-body)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M50 93 L64 121" stroke="var(--m-body)" strokeWidth="2.6" strokeLinecap="round" />
        <g>
          <rect x="46" y="99" width="16" height="21" rx="1.6" fill="var(--m-paper)" stroke="var(--m-body)" strokeWidth="1.4" />
          <path d="M40 96 H54 L58 100 V119 H40 Z" fill="var(--m-paper)" stroke="var(--m-body)" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M54 96 L58 100 H54 Z" fill="var(--m-body)" opacity="0.28" />
          <rect x="43" y="101" width="8" height="2.2" rx="1.1" fill="var(--m-gold)" />
          <rect x="43" y="106" width="12" height="1.6" rx="0.8" fill="var(--m-body)" opacity="0.55" />
          <rect x="43" y="109.5" width="12" height="1.6" rx="0.8" fill="var(--m-body)" opacity="0.55" />
          <rect x="43" y="113" width="9" height="1.6" rx="0.8" fill="var(--m-body)" opacity="0.55" />
          <path d="M43 116.5 q2 -1.8 4 0 t4 0" stroke="var(--m-body)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </g>

        {/* right chains + documents */}
        <path d="M150 93 L136 121" stroke="var(--m-body)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M150 93 L160 121" stroke="var(--m-body)" strokeWidth="2.6" strokeLinecap="round" />
        <g>
          <rect x="138" y="99" width="16" height="21" rx="1.6" fill="var(--m-paper)" stroke="var(--m-body)" strokeWidth="1.4" />
          <path d="M142 96 H156 L160 100 V119 H142 Z" fill="var(--m-paper)" stroke="var(--m-body)" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M156 96 L160 100 H156 Z" fill="var(--m-body)" opacity="0.28" />
          <rect x="145" y="101" width="8" height="2.2" rx="1.1" fill="var(--m-gold)" />
          <rect x="145" y="106" width="12" height="1.6" rx="0.8" fill="var(--m-body)" opacity="0.55" />
          <rect x="145" y="109.5" width="12" height="1.6" rx="0.8" fill="var(--m-body)" opacity="0.55" />
          <rect x="145" y="113" width="9" height="1.6" rx="0.8" fill="var(--m-body)" opacity="0.55" />
          <path d="M145 116.5 q2 -1.8 4 0 t4 0" stroke="var(--m-body)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </g>

        {/* pans */}
        <path d="M37 119 L67 119 L60 135 L44 135 Z" fill="var(--m-gold)" />
        <path d="M133 119 L163 119 L156 135 L140 135 Z" fill="var(--m-gold)" />
      </g>

      {/* judge's jabot (bobs with the head, drawn on top) */}
      <g className={styles.bob}>
        <path d="M91 74 L109 74 L107 92 Q104 98 100 92 Q96 98 93 92 Z" fill="var(--m-paper)" stroke="var(--m-body)" strokeWidth="1.3" strokeLinejoin="round" />
        <line x1="100" y1="75" x2="100" y2="90" stroke="var(--m-gold)" strokeWidth="1.3" />
        <path d="M93 80 Q100 82.5 107 80" stroke="var(--m-body)" strokeWidth="0.9" fill="none" opacity="0.4" />
        <path d="M94 85 Q100 87.5 106 85" stroke="var(--m-body)" strokeWidth="0.9" fill="none" opacity="0.4" />
      </g>
    </svg>
  );
}
