import { useState, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, useRouteError, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RequireAuth } from './RequireAuth';
import { useAuthStore } from '@/store/useAuthStore';

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
  SignPage: () => import('@/pages/SignPage'),
  SharePage: () => import('@/pages/SharePage'),
  VerifyEmailPage: () => import('@/pages/VerifyEmailPage'),
  ApprovePage: () => import('@/pages/ApprovePage'),
  ResetPasswordPage: () => import('@/pages/ResetPasswordPage'),
  LegalPage: () => import('@/pages/LegalPage'),
  ChatPage: () => import('@/pages/ChatPage'),
  WorkspacePage: () => import('@/pages/WorkspacePage'),
  DocumentsPage: () => import('@/pages/DocumentsPage'),
  DocumentDetailPage: () => import('@/pages/DocumentDetailPage'),
  TemplatesPage: () => import('@/pages/TemplatesPage'),
  PlaybooksPage: () => import('@/pages/PlaybooksPage'),
  ContractsPage: () => import('@/pages/ContractsPage'),
  BatchReviewPage: () => import('@/pages/BatchReviewPage'),
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

/**
 * React Router captures page render errors and failed lazy chunks itself, so
 * the top-level <ErrorBoundary> in App.tsx (which wraps RouterProvider) never
 * sees them. Re-throw the captured error into a fresh ErrorBoundary so a page
 * crash or a 404'd chunk shows the branded, localized fallback instead of the
 * router's bare "Unexpected Application Error" screen.
 */
function RouteErrorRethrow(): ReactElement {
  const error = useRouteError();
  throw error instanceof Error ? error : new Error(String(error));
}

const appRoutes: RouteObject[] = [
  {
    path: '/login',
    lazy: async () => ({ Component: (await loaders.AuthPage()).AuthPage }),
  },
  {
    path: '/sign/:token',
    lazy: async () => ({ Component: (await loaders.SignPage()).SignPage }),
  },
  {
    // ПУБЛИЧНЫЙ отчёт анализа по токен-ссылке (без авторизации).
    path: '/share/:token',
    lazy: async () => ({ Component: (await loaders.SharePage()).SharePage }),
  },
  {
    path: '/approve/:token',
    lazy: async () => ({ Component: (await loaders.ApprovePage()).ApprovePage }),
  },
  {
    path: '/verify-email',
    lazy: async () => ({ Component: (await loaders.VerifyEmailPage()).VerifyEmailPage }),
  },
  {
    path: '/reset-password',
    lazy: async () => ({ Component: (await loaders.ResetPasswordPage()).ResetPasswordPage }),
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
    children: [
      {
        // Public root: guests see the auth page right away, signed-in users
        // go straight to the chat. The token is read once on mount (not via
        // a store subscription) so the login fade-out animation is not cut
        // short by a re-render when the token appears mid-transition.
        index: true,
        lazy: async () => {
          const { AuthPage } = await loaders.AuthPage();
          const HomeIndex = () => {
            const [authed] = useState(() => Boolean(useAuthStore.getState().token));
            return authed ? <Navigate to="/chat" replace /> : <AuthPage />;
          };
          return { Component: HomeIndex };
        },
      },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
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
            path: 'playbooks',
            lazy: async () => ({ Component: (await loaders.PlaybooksPage()).PlaybooksPage }),
          },
          {
            path: 'contracts',
            lazy: async () => ({ Component: (await loaders.ContractsPage()).ContractsPage }),
          },
          {
            path: 'batch',
            lazy: async () => ({ Component: (await loaders.BatchReviewPage()).BatchReviewPage }),
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
        ],
      },
      {
        // Публичный 404 ВНЕ RequireAuth: аноним на битой ссылке видит честную
        // страницу «не найдено», а не молчаливый редирект на логин (soft-404,
        // за который поисковики штрафуют).
        path: '*',
        lazy: async () => ({ Component: (await loaders.NotFoundPage()).NotFoundPage }),
      },
    ],
  },
];

export const router = createBrowserRouter([
  {
    // Pathless root: one branded error boundary for every route, public pages
    // included. A page crash or a lazy-chunk 404 bubbles here and renders the
    // localized fallback instead of the router's default error screen.
    errorElement: (
      <ErrorBoundary>
        <RouteErrorRethrow />
      </ErrorBoundary>
    ),
    children: appRoutes,
  },
]);
