import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store/useUIStore';

/**
 * Reveals `text` character-by-character to mimic streaming model output.
 * Respects the global reduce-motion preference (renders instantly when set).
 * Restarts whenever `text` changes.
 */
export function useStreamingText(text: string, charsPerTick = 2, tickMs = 16) {
  const reduceMotion = useUIStore((s) => s.reduceMotion);
  const [length, setLength] = useState(reduceMotion ? text.length : 0);
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      setLength(text.length);
      return;
    }
    setLength(0);
    raf.current = setInterval(() => {
      setLength((prev) => {
        const next = Math.min(text.length, prev + charsPerTick);
        if (next >= text.length && raf.current) clearInterval(raf.current);
        return next;
      });
    }, tickMs);

    return () => {
      if (raf.current) clearInterval(raf.current);
    };
  }, [text, charsPerTick, tickMs, reduceMotion]);

  return {
    visible: text.slice(0, length),
    done: length >= text.length,
  };
}
