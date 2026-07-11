import { useUIStore } from '@/store/useUIStore';

/**
 * Resolved dark-mode flag for icon/label state. "system" is the standard
 * look and intentionally equals light, so only an explicit dark counts.
 */
export function useResolvedDark(): boolean {
  const theme = useUIStore((s) => s.theme);
  return theme === 'dark';
}
