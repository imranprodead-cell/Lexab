import { useEffect } from 'react';

const DEFAULT_TITLE = 'Lexab — Contract Intelligence';

/** Sets the browser-tab title to `«title» · Lexab` while the page is mounted; restores the default on unmount. */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Lexab` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
