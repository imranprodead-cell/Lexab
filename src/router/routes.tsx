import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from './RequireAuth';

/**
 * Pages are code-split: each route pulls its chunk on demand instead of
 * shipping every page in the initial bundle. While a lazy route resolves on
 * first load, RouterProvider shows the fallbackElement (see App.tsx); on
 * client-side navigations the current page stays visible.
 *
 * One loader per page module — reused by both the route definitions and the
 * idle-time prefetch below, so the two can never drift apart.
 */
const loaders = {
  AuthPage: () => import('@/pages/AuthPage'),
  LegalPage: () => import('@/pages/LegalPage'),
  ChatPage: () => import('@/pages/ChatPage'),
  WorkspacePage: () => import('@/pages/WorkspacePage'),
  DocumentsPage: () => import('@/pages/DocumentsPage'),
  DocumentDetailPage: () => import('@/pages/DocumentDetailPage'),
  TemplatesPage: () => import('@/pages/TemplatesPage'),
  SignaturesPage: () => import('@/pages/SignaturesPage'),
  AnalyticsPage: () => import('@/pages/AnalyticsPage'),
  PlansPage: () => import('@/pages/PlansPage'),
  TeamPage: () => import('@/pages/TeamPage'),
  ComparePage: () => import('@/pages/ComparePage'),
  ArchivePage: () => import('@/pages/ArchivePage'),
  SettingsPage: () => import('@/pages/SettingsPage'),
  NotFoundPage: () => import('@/pages/NotFoundPage'),
};

/**
 * Warm every page chunk during browser idle time, right after first paint.
 * Navigations then resolve from the module cache instantly — code-splitting
 * keeps the first load small without making later page opens pay for it.
 */
export function prefetchAllPages() {
  const warm = () => {
    for (const load of Object.values(loaders)) void load().catch(() => undefined);
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm, { timeout: 3000 });
  } else {
    setTimeout(warm, 1500);
  }
}

export const router = createBrowserRouter([
  {
    path: '/login',
    lazy: async () => ({ Component: (await loaders.AuthPage()).AuthPage }),
  },
  {
    path: '/terms',
    lazy: async () => {
      const { LegalPage } = await loaders.LegalPage();
      return { Component: () => <LegalPage kind="terms" /> };
    },
  },
  {
    path: '/privacy',
    lazy: async () => {
      const { LegalPage } = await loaders.LegalPage();
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
        lazy: async () => ({ Component: (await loaders.ChatPage()).ChatPage }),
      },
      {
        path: 'chat/:sessionId',
        lazy: async () => ({ Component: (await loaders.ChatPage()).ChatPage }),
      },
      {
        path: 'chat/:sessionId/workspace',
        lazy: async () => ({ Component: (await loaders.WorkspacePage()).WorkspacePage }),
      },
      {
        path: 'workspace',
        lazy: async () => ({ Component: (await loaders.WorkspacePage()).WorkspacePage }),
      },
      {
        path: 'documents',
        lazy: async () => ({ Component: (await loaders.DocumentsPage()).DocumentsPage }),
      },
      {
        path: 'documents/:id',
        lazy: async () => ({ Component: (await loaders.DocumentDetailPage()).DocumentDetailPage }),
      },
      {
        path: 'templates',
        lazy: async () => ({ Component: (await loaders.TemplatesPage()).TemplatesPage }),
      },
      {
        path: 'signatures',
        lazy: async () => ({ Component: (await loaders.SignaturesPage()).SignaturesPage }),
      },
      {
        path: 'analytics',
        lazy: async () => ({ Component: (await loaders.AnalyticsPage()).AnalyticsPage }),
      },
      {
        path: 'plans',
        lazy: async () => ({ Component: (await loaders.PlansPage()).PlansPage }),
      },
      {
        path: 'team',
        lazy: async () => ({ Component: (await loaders.TeamPage()).TeamPage }),
      },
      {
        path: 'compare',
        lazy: async () => ({ Component: (await loaders.ComparePage()).ComparePage }),
      },
      {
        path: 'archive',
        lazy: async () => ({ Component: (await loaders.ArchivePage()).ArchivePage }),
      },
      {
        path: 'settings',
        lazy: async () => ({ Component: (await loaders.SettingsPage()).SettingsPage }),
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await loaders.NotFoundPage()).NotFoundPage }),
      },
    ],
  },
]);
