/**
 * Единственная точка входа в Sentry для всего приложения.
 *
 * ИМЕНОВАННЫЕ статические импорты (вместо namespace import('@sentry/react'))
 * позволяют rollup выкинуть неиспользуемые Session Replay / Feedback /
 * BrowserTracing: чанк Sentry худеет с ~491KB до ~95KB (все пакеты Sentry
 * помечены sideEffects:false — tree-shaking легален). Файл импортируется
 * ТОЛЬКО динамически (main.tsx в idle, ErrorBoundary при краше) — добавление
 * сюда нового API держит это свойство, не импортируй '@sentry/react' напрямую
 * из других модулей.
 */
import { init, captureException } from '@sentry/react';

export { init, captureException };
