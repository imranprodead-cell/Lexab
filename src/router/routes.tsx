import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from './RequireAuth';

/**
 * Pages are code-split: each route pulls its chunk on demand instead of
 * shipping every page in the initial bundle. While a lazy route resolves on
 * first load, RouterProvider shows the fallbackElement (see App.tsx); on
 * client-side navigations the current page stays visible.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    lazy: async () => ({ Component: (await import('@/pages/AuthPage')).AuthPage }),
  },
  {
    path: '/terms',
    lazy: async () => {
      const { LegalPage } = await import('@/pages/LegalPage');
      return { Component: () => <LegalPage kind="terms" /> };
    },
  },
  {
    path: '/privacy',
    lazy: async () => {
      const { LegalPage } = await import('@/pages/LegalPage');
      return { Component: () => <LegalPage kind="privacy" /> };
    },
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      {
        path: 'chat',
        lazy: async () => ({ Component: (await import('@/pages/ChatPage')).ChatPage }),
      },
      {
        path: 'chat/:sessionId',
        lazy: async () => ({ Component: (await import('@/pages/ChatPage')).ChatPage }),
      },
      {
        path: 'chat/:sessionId/workspace',
        lazy: async () => ({ Component: (await import('@/pages/WorkspacePage')).WorkspacePage }),
      },
      {
        path: 'workspace',
        lazy: async () => ({ Component: (await import('@/pages/WorkspacePage')).WorkspacePage }),
      },
      {
        path: 'documents',
        lazy: async () => ({ Component: (await import('@/pages/DocumentsPage')).DocumentsPage }),
      },
      {
        path: 'documents/:id',
        lazy: async () => ({
          Component: (await import('@/pages/DocumentDetailPage')).DocumentDetailPage,
        }),
      },
      {
        path: 'templates',
        lazy: async () => ({ Component: (await import('@/pages/TemplatesPage')).TemplatesPage }),
      },
      {
        path: 'signatures',
        lazy: async () => ({ Component: (await import('@/pages/SignaturesPage')).SignaturesPage }),
      },
      {
        path: 'analytics',
        lazy: async () => ({ Component: (await import('@/pages/AnalyticsPage')).AnalyticsPage }),
      },
      {
        path: 'plans',
        lazy: async () => ({ Component: (await import('@/pages/PlansPage')).PlansPage }),
      },
      {
        path: 'team',
        lazy: async () => ({ Component: (await import('@/pages/TeamPage')).TeamPage }),
      },
      {
        path: 'compare',
        lazy: async () => ({ Component: (await import('@/pages/ComparePage')).ComparePage }),
      },
      {
        path: 'archive',
        lazy: async () => ({ Component: (await import('@/pages/ArchivePage')).ArchivePage }),
      },
      {
        path: 'settings',
        lazy: async () => ({ Component: (await import('@/pages/SettingsPage')).SettingsPage }),
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await import('@/pages/NotFoundPage')).NotFoundPage }),
      },
    ],
  },
]);
