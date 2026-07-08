/** Barrel export for the API layer. Import from `@/api` everywhere in the UI. */
export { analysisApi } from './analysis.api';
export { analyticsApi, versionsApi, userApi } from './analytics.api';
export { chatsApi } from './chats.api';
export { documentsApi } from './documents.api';
export type { DocumentQuery } from './documents.api';
export { signaturesApi } from './signatures.api';
export type { SendSignatureInput } from './signatures.api';
export { billingApi } from './billing.api';
export type { PlanLimits, UsageMetric } from './billing.api';
export { teamApi, ROLE_COLORS } from './team.api';
export type { TeamMember, TeamInvitation, TeamRole } from './team.api';
export { templatesApi } from './templates.api';
export { ApiError } from './util';
export { USE_MOCK } from './client';
