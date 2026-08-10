/**
 * Клиент админ-панели владельца.
 *
 * Ни одна проверка доступа тут не живёт и жить не может: браузерный код видно
 * всем. Сервер отвечает 404 на каждый маршрут, если почта не в ADMIN_EMAILS —
 * страница просто ничего не получит.
 */
import { http } from './client';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  firm: string | null;
  createdAt: string;
  plan: string;
  status: string;
  renewsAt: string | null;
  grantNote: string | null;
  hasCustomLimits: boolean;
}

export interface AdminLimits {
  ai: number | null;
  docs: number | null;
  storageMb: number | null;
  seats: number | null;
  apiMonthly: number | null;
  overridden: string[];
}

export interface AdminUserCard {
  user: { id: string; email: string; name: string; firm: string | null; createdAt: string };
  subscription: {
    plan: string;
    status: string;
    period: string | null;
    renewsAt: string | null;
    grantedBy: string | null;
    grantNote: string | null;
  };
  planLimits: Omit<AdminLimits, 'overridden'>;
  limits: AdminLimits;
  usage: { aiRequests: number; documents: number; storageMb: number };
  history: { kind: string; plan: string | null; payload: Record<string, unknown>; at: string }[];
}

export interface AdminStats {
  users: number;
  customLimits: number;
  grantsLast30Days: number;
  byPlan: { plan: string; count: number }[];
}

/** Значение поля лимита: число, 'unlimited' (без ограничения) или null (по тарифу). */
export type LimitValue = number | 'unlimited' | null;

export const adminApi = {
  whoami: (signal?: AbortSignal) => http<{ admin: true; email: string; plans: string[] }>('/admin/whoami', { signal }),
  stats: (signal?: AbortSignal) => http<AdminStats>('/admin/stats', { signal }),
  users: (q: string, signal?: AbortSignal) =>
    http<{ users: AdminUserRow[] }>(`/admin/users?q=${encodeURIComponent(q)}`, { signal }),
  user: (id: string, signal?: AbortSignal) => http<AdminUserCard>(`/admin/users/${id}`, { signal }),
  grantPlan: (id: string, body: { plan: string; months?: number | null; until?: string | null; period?: 'monthly' | 'yearly'; note?: string }) =>
    http<{ ok: true; plan: string; renewsAt: string | null }>(`/admin/users/${id}/plan`, { method: 'POST', body }),
  setLimits: (id: string, body: Partial<Record<'ai' | 'docs' | 'storageMb' | 'seats' | 'apiMonthly', LimitValue>> & { note?: string }) =>
    http<{ ok: true; limits: AdminLimits }>(`/admin/users/${id}/limits`, { method: 'PUT', body }),
  resetLimits: (id: string) => http<{ ok: true; limits: AdminLimits }>(`/admin/users/${id}/limits`, { method: 'DELETE' }),
  resetUsage: (id: string) =>
    http<{ ok: true; usage: { aiRequests: number; docsCreated: number } }>(`/admin/users/${id}/usage/reset`, { method: 'POST', body: {} }),
};
