import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';
import { prefetchDicts } from '@/i18n/loadDict';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastHost } from '@/components/ui/ToastHost';
import { prefetchAllPages, router } from '@/router/routes';

export default function App() {
  // Warm all page chunks once the first screen has painted.
  useEffect(() => {
    prefetchAllPages();
    // Тёплый кэш ленивых словарей: переключение языка остаётся мгновенным.
    prefetchDicts();
  }, []);

  return (
    <ErrorBoundary>
      {/* MotionConfig НАМЕРЕННО НЕ ЗДЕСЬ. Обёртка в корне тянула библиотеку
          анимаций (48.7 КБ gzip) в первую загрузку КАЖДОГО посетителя, включая
          страницы-разделы сайта, где нет ни одной анимации. Она перенесена в
          две ветки, которые действительно анимируют, — AppShell и AuthPage;
          настройка reducedMotion="user" там та же. Добавляете анимации в новом
          дереве — оберните это дерево своим MotionConfig, а не корень. */}
      <I18nProvider>
        <RouterProvider
          router={router}
          // The first-load gap lasts a few hundred ms — anything animated here
          // only flashes, so the fallback stays intentionally blank.
          fallbackElement={<div style={{ minHeight: '100vh' }} />}
        />
        {/* Mounted at the app root (not in AppShell) so toasts show on public
            routes too — AuthPage, reset-password, sign, etc. Portals to body. */}
        <ToastHost />
      </I18nProvider>
    </ErrorBoundary>
  );
}
