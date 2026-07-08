import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/useUIStore';

/**
 * Global keyboard shortcuts (Linear-inspired):
 *   g then c/d/t/e/a/s → navigate to a section
 *   \                  → pin / unpin the side rail
 *
 * Shortcuts are ignored while typing in an input, textarea, or contenteditable.
 */
const NAV_MAP: Record<string, string> = {
  c: '/chat',
  d: '/documents',
  t: '/templates',
  e: '/signatures',
  a: '/analytics',
  s: '/settings',
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const toggleRailPinned = useUIStore((s) => s.toggleRailPinned);

  useEffect(() => {
    let awaitingNavKey = false;
    let resetTimer: ReturnType<typeof setTimeout>;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '\\') {
        e.preventDefault();
        toggleRailPinned();
        return;
      }

      if (awaitingNavKey) {
        const dest = NAV_MAP[e.key.toLowerCase()];
        awaitingNavKey = false;
        clearTimeout(resetTimer);
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        awaitingNavKey = true;
        resetTimer = setTimeout(() => {
          awaitingNavKey = false;
        }, 1200);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(resetTimer);
    };
  }, [navigate, toggleRailPinned]);
}
