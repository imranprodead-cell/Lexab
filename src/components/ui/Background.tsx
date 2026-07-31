import { useEffect, useRef, type RefObject } from 'react';

/**
 * Анимированный фон из дизайн-эталона: три путешествующих градиентных пятна
 * (bloom-roam-* в global.css), сетка с радиальной маской, 12 мерцающих
 * звёздочек и слой noise. Параллакс — на rAF по скроллу контейнера
 * (scrollRef) или окна; при reduce-motion параллакс не подключается,
 * а бесконечные CSS-циклы глушит global.css.
 */

const SPARKS: { left: string; top: string; size: number; dur: number; delay: number }[] = [
  { left: '8%', top: '18%', size: 14, dur: 3.6, delay: 0.2 },
  { left: '16%', top: '64%', size: 10, dur: 4.4, delay: 1.1 },
  { left: '23%', top: '32%', size: 12, dur: 3.2, delay: 2.0 },
  { left: '31%', top: '78%', size: 9, dur: 5.0, delay: 0.6 },
  { left: '42%', top: '12%', size: 16, dur: 4.0, delay: 1.6 },
  { left: '51%', top: '52%', size: 10, dur: 3.4, delay: 2.6 },
  { left: '58%', top: '26%', size: 13, dur: 4.8, delay: 0.9 },
  { left: '66%', top: '70%', size: 11, dur: 3.8, delay: 1.9 },
  { left: '74%', top: '16%', size: 15, dur: 4.2, delay: 0.4 },
  { left: '81%', top: '48%', size: 10, dur: 3.6, delay: 2.3 },
  { left: '88%', top: '30%', size: 12, dur: 5.2, delay: 1.4 },
  { left: '94%', top: '62%', size: 9, dur: 4.6, delay: 3.0 },
];

/** Четырёхлучевая звезда эталона. */
function SparkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c1.2 7.4 4.6 10.8 12 12-7.4 1.2-10.8 4.6-12 12-1.2-7.4-4.6-10.8-12-12C7.4 10.8 10.8 7.4 12 0Z" />
    </svg>
  );
}

/** Линейная проекция скролла [0..900] в сдвиг [0..max] (парллакс-фактор). */
const shift = (scrollTop: number, max: number) => Math.min(scrollTop, 900) * (max / 900);

export function Background({ scrollRef }: { scrollRef?: RefObject<HTMLElement | null> }) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const aRef = useRef<HTMLDivElement | null>(null);
  const bRef = useRef<HTMLDivElement | null>(null);
  const cRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduce =
      document.documentElement.getAttribute('data-reduce-motion') === 'true' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const target: HTMLElement | Window = scrollRef?.current ?? window;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top =
          target instanceof Window ? target.scrollY : (target as HTMLElement).scrollTop;
        if (gridRef.current) gridRef.current.style.translate = `0 ${shift(top, 50)}px`;
        if (aRef.current) aRef.current.style.translate = `0 ${shift(top, 90)}px`;
        if (bRef.current) bRef.current.style.translate = `0 ${shift(top, 140)}px`;
        if (cRef.current) cRef.current.style.translate = `0 ${shift(top, 60)}px`;
      });
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        contain: 'layout paint',
      }}
    >
      {/* сетка с маской */}
      <div
        ref={gridRef}
        className="bg-grid"
        style={{ position: 'absolute', inset: '-8% 0 auto 0', height: '130vh' }}
      />
      {/* путешествующие пятна */}
      <div
        ref={aRef}
        style={{ position: 'absolute', left: '-18%', top: '-25%', width: '50rem', height: '50rem' }}
      >
        <div className="bloom bloom--a" style={{ inset: 0 }} />
      </div>
      <div
        ref={bRef}
        style={{ position: 'absolute', right: '-20%', top: '-12%', width: '54rem', height: '54rem' }}
      >
        <div className="bloom bloom--b" style={{ inset: 0 }} />
      </div>
      <div
        ref={cRef}
        style={{ position: 'absolute', left: '30%', top: '38%', width: '36rem', height: '36rem' }}
      >
        <div className="bloom bloom--c" style={{ inset: 0 }} />
      </div>
      {/* мерцающие звёздочки — fill-mode backwards держит первый кадр */}
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
          <SparkIcon size={s.size} />
        </span>
      ))}
      {/* плёнка шума поверх */}
      <div className="noise" style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
