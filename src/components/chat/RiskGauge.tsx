import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/lib/scroll';
import styles from './chat.module.css';

interface RiskGaugeProps {
  score: number; // 0..100
}

/* Вариант 2b макета «Шкала риска» (цвет по зонам + пульс): дуга — градиент
   зелёный → жёлтый (середина) → красный, число набирается вместе с дугой и
   красится в цвет её конца; по приходу к значению — два импульса ореола. */

const SIZE = 132;
/** Толщина кольца = диаметр точек-«шапок» на концах дуги. */
const RING = 10;
/** Радиус, по которому ходит центр точки на конце дуги. */
const CAP_R = SIZE / 2 - RING / 2;
const SWEEP_MS = 2200;

const GREEN = [63, 178, 107];
const YELLOW = [242, 194, 48];
const RED = [229, 72, 59];
const GRADIENT = 'conic-gradient(#3fb26b, #f2c230 180deg, #e5483b 360deg)';

const mix = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

/** Цвет градиента в точке p (0..1) — тот же, что видно на дуге в этом месте. */
function zoneColor(p: number): string {
  const x = Math.min(1, Math.max(0, p));
  return x <= 0.5 ? mix(GREEN, YELLOW, x / 0.5) : mix(YELLOW, RED, (x - 0.5) / 0.5);
}

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Radial risk gauge — zone-coloured sweep, count-up and an arrival pulse. */
export function RiskGauge({ score }: RiskGaugeProps) {
  const target = Math.min(100, Math.max(0, score));
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let raf = 0;
    if (prefersReducedMotion()) {
      raf = requestAnimationFrame(() => setProgress(1));
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const x = Math.min(1, Math.max(0, (now - t0) / SWEEP_MS));
      setProgress(easeInOutCubic(x));
      setPulse(x === 1);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const value = target * progress;
  const deg = Math.min(359.9, value * 3.6);
  const rad = (deg * Math.PI) / 180;
  const color = zoneColor(value / 100);
  const capsOn = progress > 0.002;

  return (
    <div className={styles.gaugeWrap} role="img" aria-label={`risk score ${score} / 100`}>
      <div className={styles.gauge} aria-hidden="true">
        {pulse ? <div className={styles.gaugeHalo} style={{ borderColor: zoneColor(target / 100) }} /> : null}
        <div
          className={styles.gaugeRing}
          style={{
            background: `conic-gradient(transparent 0 ${deg}deg, var(--border) ${deg}deg 360deg), ${GRADIENT}`,
          }}
        />
        {capsOn ? (
          <>
            <div className={styles.gaugeCap} style={{ left: CAP_R, top: 0, background: zoneColor(0) }} />
            <div
              className={styles.gaugeCap}
              style={{ left: CAP_R + CAP_R * Math.sin(rad), top: CAP_R - CAP_R * Math.cos(rad), background: color }}
            />
          </>
        ) : null}
        <div className={styles.gaugeCenter}>
          <div className={styles.gaugeNum} style={{ color }}>
            {progress === 1 ? score : Math.round(value)}
          </div>
          <div className={styles.gaugeOf}>/ 100</div>
        </div>
      </div>
      <div className={styles.gaugeLabel} aria-hidden="true">
        risk score
      </div>
    </div>
  );
}
