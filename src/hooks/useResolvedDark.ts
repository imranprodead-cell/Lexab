import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/useUIStore';

/**
 * Resolved dark-mode flag for icon/label state. Unlike reading matchMedia
 * inline during render, this stays in sync when theme === 'system' and the
 * OS switches its colour scheme while the page is open.
 */
export function useResolvedDark(): boolean {
  const theme = useUIStore((s) => s.theme);
  const [sysDark, setSysDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    setSysDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return theme === 'dark' || (theme === 'system' && sysDark);
}
