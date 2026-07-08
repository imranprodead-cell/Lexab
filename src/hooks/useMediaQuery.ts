import { useSyncExternalStore } from 'react';

/** Subscribe to a CSS media query; re-renders on change. SSR-safe default. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Convenience breakpoints used across the app. */
export const useIsNarrow = () => useMediaQuery('(max-width: 900px)');
export const useIsMobile = () => useMediaQuery('(max-width: 600px)');
