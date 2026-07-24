import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store/useUIStore';

/** Keys whose typewriter already ran (e.g. an analysis summary): reopening
 *  the same chat — or reloading the page — shows the text instantly instead
 *  of replaying the animation. Persisted in localStorage (capped), so a
 *  refresh or a next-day visit doesn't re-type old content. */
const SEEN_STORAGE_KEY = 'lexab.seenAnim';
const SEEN_CAP = 300;

const seenKeys = new Set<string>(
  (() => {
    try {
      const raw = localStorage.getItem(SEEN_STORAGE_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? (arr.filter((k) => typeof k === 'string') as string[]) : [];
    } catch {
      return [];
    }
  })(),
);

function markSeen(key: string) {
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  try {
    // Keep insertion order; drop the oldest beyond the cap.
    const arr = [...seenKeys];
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(arr.slice(Math.max(0, arr.length - SEEN_CAP))));
  } catch {
    /* storage blocked — the mark still holds for this tab */
  }
}

/**
 * Reveals `text` character-by-character to mimic streaming model output.
 * Respects the global reduce-motion preference (renders instantly when set).
 * Restarts whenever `text` changes. Pass `onceKey` (a stable id) to animate
 * only the FIRST time that content is shown in this session.
 */
export function useStreamingText(text: string, charsPerTick = 2, tickMs = 16, onceKey?: string) {
  const reduceMotion = useUIStore((s) => s.reduceMotion);
  const skip = reduceMotion || (onceKey !== undefined && seenKeys.has(onceKey));
  const [length, setLength] = useState(skip ? text.length : 0);
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (reduceMotion || (onceKey !== undefined && seenKeys.has(onceKey))) {
      setLength(text.length);
      return;
    }
    // Mark at animation START — leaving the page mid-animation must not
    // replay the whole typewriter on the next visit.
    if (onceKey !== undefined) markSeen(onceKey);
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
  }, [text, charsPerTick, tickMs, reduceMotion, onceKey]);

  return {
    visible: text.slice(0, length),
    done: length >= text.length,
  };
}
