import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  to: number;
  decimals?: number;
  /** Суффикс после числа (по умолчанию — ничего). */
  suffix?: string;
  /** Длительность в секундах (эталон: 0.8, easeOut). */
  duration?: number;
}

/** Счётчик метрик из дизайн-эталона: при появлении в вьюпорте число
 *  набегает от 0 до значения (easeOut), десятичный разделитель — запятая.
 *  Ширина резервируется в ch по финальной длине — вёрстка не дёргается.
 *  При reduce-motion значение ставится сразу. */
export function CountUp({ to, decimals = 0, suffix = '', duration = 0.8 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  const format = (n: number) => n.toFixed(decimals).replace('.', ',') + suffix;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce =
      document.documentElement.getAttribute('data-reduce-motion') === 'true' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(to);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started.current) return;
        started.current = true;
        io.disconnect();
        const t0 = performance.now();
        const durMs = duration * 1000;
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / durMs);
          const eased = 1 - Math.pow(1 - p, 3); // easeOut cubic
          setValue(to * eased);
          if (p < 1) requestAnimationFrame(tick);
          else setValue(to);
        };
        requestAnimationFrame(tick);
      },
      { rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} style={{ display: 'inline-block', minWidth: `${format(to).length}ch` }}>
      {format(value)}
    </span>
  );
}
