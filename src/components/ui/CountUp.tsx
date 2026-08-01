/* Скопировано дословно из эталона "new design/components/CountUp.tsx".
   Изменены только именованный экспорт и классы→inline-стили (нет Tailwind);
   значения анимации (0.8s easeOut, useInView -40px once) — эталонные. */
import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';

export function CountUp({
  to,
  decimals = 0,
  /* Отличие от эталона: по умолчанию БЕЗ суффикса — в кабинете счётчики
     считают штуки/часы, «%» ставится явно там, где это проценты (лендинг). */
  suffix = '',
  /* Эталонная длительность 0.8s; главный экран передаёт 3.5s (просьба
     пользователя: медленнее и заметнее). */
  duration = 0.8,
}: {
  to: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setValue(to);
      return;
    }
    const controls = animate(0, to, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [inView, reduce, to, duration]);

  const final = to.toFixed(decimals).replace('.', ',') + suffix;

  return (
    <span
      ref={ref}
      style={{
        display: 'inline-block',
        textAlign: 'left',
        fontVariantNumeric: 'tabular-nums',
        minWidth: `${final.length}ch`,
      }}
    >
      {value.toFixed(decimals).replace('.', ',')}
      {suffix}
    </span>
  );
}
