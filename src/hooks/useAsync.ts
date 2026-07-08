import { useEffect, useRef, useState } from 'react';

/** Close a popover/menu on outside-click and Escape. Returns a ref to attach. */
export function useDismissable<T extends HTMLElement>(onDismiss: () => void, active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onDismiss, active]);

  return ref;
}

/**
 * Session-scoped cache of resolved results, keyed per call site + deps.
 * Lets a revisited page render instantly from the last known data while a
 * fresh request revalidates in the background (stale-while-revalidate).
 */
const asyncCache = new Map<string, unknown>();

/** Drop all cached results (call on login/logout so accounts never mix). */
export function clearAsyncCache() {
  asyncCache.clear();
}

function cacheKeyOf(fetcher: (signal: AbortSignal) => Promise<unknown>, deps: unknown[]) {
  try {
    // The fetcher's source text identifies the call site; deps identify the
    // variant (id, filters, …) — every dynamic input must be listed in deps.
    return `${fetcher.toString()}|${JSON.stringify(deps)}`;
  } catch {
    return null; // non-serializable deps — skip caching for this call
  }
}

/**
 * Generic async-resource hook: runs `fetcher` on mount (and when `deps` change),
 * exposing loading / error / data and a `reload` action. Aborts in-flight
 * requests on unmount or dependency change.
 *
 * Results are cached for the session: revisiting a page shows the cached data
 * immediately (no spinner) and silently refreshes it in the background.
 */
export function useAsync<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const key = cacheKeyOf(fetcher, deps);
  const cached = key !== null && asyncCache.has(key) ? (asyncCache.get(key) as T) : null;
  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const hasCached = key !== null && asyncCache.has(key);
    if (hasCached) {
      // Instant render from cache; the fetch below revalidates silently.
      setData(asyncCache.get(key) as T);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    fetcher(controller.signal)
      .then((result) => {
        if (key !== null && result != null) asyncCache.set(key, result);
        if (alive) setData(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        // With stale data on screen a failed refresh stays silent; the next
        // visit or reload() retries.
        if (!hasCached) setError(err instanceof Error ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
