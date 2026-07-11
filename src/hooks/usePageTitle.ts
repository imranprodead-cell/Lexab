import { useEffect } from 'react';

const DEFAULT_TITLE = 'LexAI — Contract Intelligence';

/** Sets the browser-tab title to `«title» · LexAI` while the page is mounted; restores the default on unmount. */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · LexAI` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
