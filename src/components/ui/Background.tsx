/* Скопировано дословно из эталона "new design/components/Background.tsx".
   Изменения ТОЛЬКО адаптационные: Tailwind-классы позиций переведены в
   inline-стили с теми же значениями, и useScroll получает container —
   у нас страница скроллится во внутреннем контейнере, а не в window.
   Все числа (позиции, размеры, диапазоны параллакса, SPARKS) — эталонные. */
import type { RefObject } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';

const SPARKS = [
  { left: '12%', top: '16%', size: 12, dur: 3.6, delay: 0 },
  { left: '28%', top: '34%', size: 10, dur: 4.4, delay: 1.2 },
  { left: '44%', top: '12%', size: 12, dur: 3.2, delay: 0.6 },
  { left: '56%', top: '40%', size: 14, dur: 4.8, delay: 2 },
  { left: '68%', top: '18%', size: 10, dur: 4.2, delay: 1.7 },
  { left: '83%', top: '30%', size: 12, dur: 3.9, delay: 2.6 },
  { left: '20%', top: '58%', size: 10, dur: 4.6, delay: 3.1 },
  { left: '48%', top: '68%', size: 12, dur: 5, delay: 0.9 },
  { left: '74%', top: '60%', size: 10, dur: 3.4, delay: 2.2 },
  { left: '34%', top: '82%', size: 10, dur: 4.9, delay: 1.5 },
  { left: '88%', top: '78%', size: 12, dur: 4.1, delay: 0.4 },
  { left: '8%', top: '80%', size: 10, dur: 4.5, delay: 2.9 },
];

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ height: '100%', width: '100%' }}>
      <path d="M12 0c1.2 7.4 4.6 10.8 12 12-7.4 1.2-10.8 4.6-12 12-1.2-7.4-4.6-10.8-12-12C7.4 10.8 10.8 7.4 12 0Z" />
    </svg>
  );
}

export function Background({ scrollRef }: { scrollRef?: RefObject<HTMLElement | null> }) {
  const { scrollY } = useScroll(scrollRef ? { container: scrollRef as RefObject<HTMLElement> } : undefined);
  const gridY = useTransform(scrollY, [0, 900], [0, 50]);
  const bloomAY = useTransform(scrollY, [0, 900], [0, 90]);
  const bloomBY = useTransform(scrollY, [0, 900], [0, 140]);
  const bloomCY = useTransform(scrollY, [0, 900], [0, 60]);

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        contain: 'layout paint',
        pointerEvents: 'none',
      }}
    >
      {/* colour blooms, different parallax speeds, slow breathing.
          willChange: параллакс двигает эти слои из JS на каждый кадр скролла —
          постоянная промоция в GPU-слой убирает пере-растеризацию на слабых
          устройствах (визуально ничего не меняет). */}
      <motion.div style={{ y: bloomAY, position: 'absolute', left: '-18%', top: '-25%', willChange: 'transform' }}>
        <div className="bloom bloom--a" style={{ height: '50rem', width: '50rem' }} />
      </motion.div>
      <motion.div style={{ y: bloomBY, position: 'absolute', right: '-15%', top: '-12%', willChange: 'transform' }}>
        <div className="bloom bloom--b" style={{ height: '54rem', width: '54rem' }} />
      </motion.div>
      <motion.div style={{ y: bloomCY, position: 'absolute', left: '24%', top: '38%', willChange: 'transform' }}>
        <div className="bloom bloom--c" style={{ height: '36rem', width: '36rem' }} />
      </motion.div>

      {/* the same subtle line grid as before, radial mask + soft pulse */}
      <motion.div
        style={{ y: gridY, position: 'absolute', left: 0, right: 0, top: '-2.5rem', height: '130vh', willChange: 'transform' }}
        className="bg-grid"
      />

      {/* twinkling glints across the viewport */}
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="sparkle"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDuration: `${s.dur}s`,
            animationDelay: `${s.delay}s`,
          }}
        >
          <SparkIcon />
        </span>
      ))}

      {/* premium grain */}
      <div className="noise" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </div>
  );
}
