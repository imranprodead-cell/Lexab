import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from './RequireAuth';
import { AuthPage } from '@/pages/AuthPage';
import { ChatPage } from '@/pages/ChatPage';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { DocumentDetailPage } from '@/pages/DocumentDetailPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { SignaturesPage } from '@/pages/SignaturesPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PlansPage } from '@/pages/PlansPage';
import { TeamPage } from '@/pages/TeamPage';
import { ComparePage } from '@/pages/ComparePage';
import { ArchivePage } from '@/pages/ArchivePage';
import { LegalPage } from '@/pages/LegalPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const router = createBrowserRouter([
  { path: '/login', element: <AuthPage /> },
  { path: '/terms', element: <LegalPage kind="terms" /> },
  { path: '/privacy', element: <LegalPage kind="privacy" /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:sessionId', element: <ChatPage /> },
      { path: 'chat/:sessionId/workspace', element: <WorkspacePage /> },
      { path: 'workspace', element: <WorkspacePage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'documents/:id', element: <DocumentDetailPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'signatures', element: <SignaturesPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'archive', element: <ArchivePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
