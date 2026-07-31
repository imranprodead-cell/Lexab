import { useCallback, useRef } from 'react';

/**
 * Каскад появления из дизайн-эталона (аналог whileInView): элемент скрыт,
 * при входе в вьюпорт один раз проигрывает lx-reveal-up (global.css) с
 * easing cubic-bezier(0.16,1,0.3,1) и заданной задержкой.
 *
 *   <div ref={useReveal(0.1)}>…</div>
 *
 * При reduce-motion (тумблер приложения или системный) элемент просто виден.
 */

const reducedMotion = () =>
  document.documentElement.getAttribute('data-reduce-motion') === 'true' ||
  (typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Один общий IntersectionObserver на все элементы (margin эталона -80px). */
let sharedObserver: IntersectionObserver | null = null;
const pending = new WeakMap<Element, () => void>();

function observe(el: Element, onEnter: () => void) {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const fire = pending.get(entry.target);
          if (fire) {
            pending.delete(entry.target);
            sharedObserver?.unobserve(entry.target);
            fire();
          }
        }
      },
      { rootMargin: '0px 0px -80px 0px' },
    );
  }
  pending.set(el, onEnter);
  sharedObserver.observe(el);
}

export function useReveal<T extends HTMLElement = HTMLElement>(delaySeconds = 0) {
  const nodeRef = useRef<T | null>(null);
  return useCallback(
    (el: T | null) => {
      const prev = nodeRef.current;
      if (prev && prev !== el) {
        pending.delete(prev);
        sharedObserver?.unobserve(prev);
      }
      nodeRef.current = el;
      if (!el) return;
      // jsdom-тесты и reduce-motion: элемент просто виден, без анимации.
      if (typeof IntersectionObserver === 'undefined' || reducedMotion()) return;
      el.classList.add('anim-reveal');
      el.style.opacity = '0'; // скрыт до входа в вьюпорт (fill-mode доигрaет)
      el.style.setProperty('--reveal-delay', `${delaySeconds}s`);
      observe(el, () => {
        el.style.removeProperty('opacity');
        el.classList.add('is-inview');
      });
    },
    [delaySeconds],
  );
}
