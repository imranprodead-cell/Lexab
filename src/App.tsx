import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { router } from '@/router/routes';

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </ErrorBoundary>
  );
}
