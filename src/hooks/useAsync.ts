import { useEffect, useRef, useState } from 'react';

/** Close a popover/menu on outside-click and Escape. Returns a ref to attach. */
export function useDismissable<T extends HTMLElement>(onDismiss: () => void, active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Element;
      // Floating layers (calendar popovers, …) render in portals outside the
      // host element — clicking inside them must not dismiss the host.
      if (target.closest?.('[data-popover-layer]')) return;
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

/** Mounted useAsync hooks subscribe here so a cache clear re-fetches them
 *  immediately (plan purchase, document deletion, …) — no page reload. */
const cacheListeners = new Set<() => void>();

/** Drop all cached results and re-run every mounted fetcher (login/logout,
 *  plan purchase, deletions — anything that changes what pages should show). */
export function clearAsyncCache() {
  asyncCache.clear();
  for (const listener of [...cacheListeners]) listener();
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
  // Mirrors `data` so the fetch effect can tell "have something on screen"
  // apart from "first load" without re-running on every data change.
  const dataRef = useRef<T | null>(cached);
  dataRef.current = data;

  // clearAsyncCache() → silently re-fetch while keeping the current data on
  // screen (no loading flash) so e.g. the sidebar plan updates in place.
  useEffect(() => {
    const listener = () => setNonce((n) => n + 1);
    cacheListeners.add(listener);
    return () => {
      cacheListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const hasCached = key !== null && asyncCache.has(key);
    if (hasCached) {
      // Instant render from cache; the fetch below revalidates silently.
      setData(asyncCache.get(key) as T);
      setLoading(false);
    } else if (dataRef.current === null) {
      setLoading(true);
    }
    // With data already on screen (e.g. after clearAsyncCache) the refresh is
    // silent — no skeleton flash; new data swaps in when it arrives.
    setError(null);

    fetcher(controller.signal)
      .then((result) => {
        // A superseded fetch (reload()/unmount already happened) must not
        // touch the CACHE either — otherwise its stale list would overwrite
        // an optimistic mutate() (deleted row resurrects, created row vanishes).
        if (!alive || controller.signal.aborted) return;
        if (key !== null && result != null) asyncCache.set(key, result);
        setData(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        // The resource is gone (deleted document/chat): drop the stale cache
        // and surface the error instead of showing a "zombie" page forever.
        const status = (err as { status?: number }).status;
        if (status === 404 && key !== null) {
          asyncCache.delete(key);
          setData(null);
          setError(err instanceof Error ? err.message : 'Not found.');
          return;
        }
        // With data ON SCREEN a failed refresh stays silent (the next visit or
        // reload() retries) — including right after clearAsyncCache(), when
        // the cache is empty but the old list is still rendered.
        if (!hasCached && dataRef.current === null) setError(err instanceof Error ? err.message : 'Something went wrong.');
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

  /** Optimistically replace the on-screen data AND the session cache — e.g.
   *  insert a just-created row instantly instead of waiting for a refetch.
   *  Pair with reload() to true-up against the server in the background. */
  const mutate = (updater: (prev: T | null) => T | null) => {
    setData((prev) => {
      const next = updater(prev);
      if (key !== null) {
        if (next == null) asyncCache.delete(key);
        else asyncCache.set(key, next);
      }
      return next;
    });
  };

  return { data, loading, error, reload: () => setNonce((n) => n + 1), mutate };
}
