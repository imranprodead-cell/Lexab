import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/ui/States';
import { prefetchAllPages, router } from '@/router/routes';

export default function App() {
  // Warm all page chunks once the first screen has painted.
  useEffect(() => {
    prefetchAllPages();
  }, []);

  return (
    <ErrorBoundary>
      <I18nProvider>
        <RouterProvider
          router={router}
          fallbackElement={
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
              <LoadingState />
            </div>
          }
        />
      </I18nProvider>
    </ErrorBoundary>
  );
}
