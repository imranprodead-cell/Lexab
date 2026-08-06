/**
 * Реестр публичных страниц-разделов.
 *
 * ЛЕЖИТ ОТДЕЛЬНО ОТ `loaders` В src/router/routes.tsx НАМЕРЕННО. Тот объект
 * целиком прогревается в простое для ВОШЕДШЕГО пользователя (prefetchAllPages).
 * Маркетинговые страницы вошедшему не нужны — попав в `loaders`, они начали бы
 * молча качаться в фоне у каждого работающего юриста. Здесь же — только
 * ленивые импорты для роутера, без прогрева.
 *
 * Слаг = путь = имя каталога в dist. Латиница, не переводится: переведённый
 * слаг навсегда лишает возможности сменить язык, оставшись на странице.
 */
import { lazy, type LazyExoticComponent, type ComponentType } from 'react';

export interface PublicPageEntry {
  slug: string;
  Component: LazyExoticComponent<ComponentType>;
}

export const PUBLIC_PAGES: PublicPageEntry[] = [
  {
    slug: 'contract-analysis',
    Component: lazy(() =>
      import('./pages/ContractAnalysisPage').then((m) => ({ default: m.ContractAnalysisPage })),
    ),
  },
  {
    slug: 'legal-base',
    Component: lazy(() => import('./pages/LegalBasePage').then((m) => ({ default: m.LegalBasePage }))),
  },
  {
    slug: 'document-chat',
    Component: lazy(() => import('./pages/DocumentChatPage').then((m) => ({ default: m.DocumentChatPage }))),
  },
  {
    slug: 'version-compare',
    Component: lazy(() => import('./pages/VersionComparePage').then((m) => ({ default: m.VersionComparePage }))),
  },
  {
    slug: 'contract-templates',
    Component: lazy(() => import('./pages/ContractTemplatesPage').then((m) => ({ default: m.ContractTemplatesPage }))),
  },
  {
    slug: 'clause-playbooks',
    Component: lazy(() => import('./pages/ClausePlaybooksPage').then((m) => ({ default: m.ClausePlaybooksPage }))),
  },
  {
    slug: 'approvals-and-deadlines',
    Component: lazy(() =>
      import('./pages/ApprovalsAndDeadlinesPage').then((m) => ({ default: m.ApprovalsAndDeadlinesPage })),
    ),
  },
  {
    slug: 'bulk-review',
    Component: lazy(() => import('./pages/BulkReviewPage').then((m) => ({ default: m.BulkReviewPage }))),
  },
  {
    slug: 'team-access',
    Component: lazy(() => import('./pages/TeamAccessPage').then((m) => ({ default: m.TeamAccessPage }))),
  },
  {
    slug: 'security',
    Component: lazy(() => import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage }))),
  },
  {
    slug: 'integrations',
    Component: lazy(() => import('./pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage }))),
  },
  {
    slug: 'for-developers',
    Component: lazy(() => import('./pages/ForDevelopersPage').then((m) => ({ default: m.ForDevelopersPage }))),
  },
  {
    slug: 'pricing',
    Component: lazy(() => import('./pages/PricingPage').then((m) => ({ default: m.PricingPage }))),
  },
];

/** Слаги публичных страниц — для тестов согласованности и генерации robots.txt. */
export const PUBLIC_SLUGS = PUBLIC_PAGES.map((p) => p.slug);
