import { useCallback, useRef } from 'react';

/** 3D-tilt карточки из дизайн-эталона (AuthCard): лёгкий наклон за курсором,
 *  амплитуда ±2.5°, перспектива 900px. Только для точных указателей
 *  ((pointer: fine)) и при выключенном reduce-motion. */
const MAX_TILT = 2.5;

export function useTilt<T extends HTMLElement = HTMLElement>() {
  const frame = useRef(0);
  return useCallback((el: T | null) => {
    if (!el) return;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduce =
      document.documentElement.getAttribute('data-reduce-motion') === 'true' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduce) return;

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5; // -0.5..0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.style.transition = 'transform 0.16s ease-out';
        el.style.transform = `perspective(900px) rotateX(${(-py * MAX_TILT * 2).toFixed(2)}deg) rotateY(${(px * MAX_TILT * 2).toFixed(2)}deg)`;
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame.current);
      el.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    // Узел живёт, пока смонтирована карточка; слушатели умирают вместе с ним.
  }, []);
}
