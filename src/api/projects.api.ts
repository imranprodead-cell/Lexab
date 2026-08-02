/**
 * Projects API — «дела» юриста: папки, внутри которых живут договоры одного
 * клиента/спора. Доступно всем тарифам. Бэкенд: server/src/routes/projects.routes.ts.
 */
import type { Project } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { ApiError, clone, delay } from './util';

/**
 * Одноразовый ключ «Новый договор из проекта»: ProjectDetailPage кладёт сюда
 * id дела перед уходом на страницу анализа; useChatStore ПОТРЕБЛЯЕТ его в момент
 * СТАРТА анализа (read+clear), держит локально и после успеха переносит документ
 * в проект. Потребление на старте (а не на финише) закрывает две проблемы:
 *  — провалившийся/следующий НЕсвязанный анализ больше не утащит договор в старое
 *    дело (ключ уже погашен);
 *  — второй анализ не подхватит чужой ключ.
 * Хранится как {id, ts}; протухает за PENDING_TTL_MS (защита от «поставил ключ и
 * забыл, а потом загрузил другой договор»).
 */
export const PENDING_PROJECT_KEY = 'lexab.pendingProject';
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 минут

/** Пометить: следующий стартованный анализ подшить в это дело. */
export function setPendingProject(id: string): void {
  try {
    sessionStorage.setItem(PENDING_PROJECT_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch {
    /* приватный режим: документ просто останется в общем списке */
  }
}

/** Прочитать И СРАЗУ погасить ключ; вернуть id дела, если он свежий, иначе null. */
export function consumePendingProject(): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_PROJECT_KEY);
    if (raw !== null) sessionStorage.removeItem(PENDING_PROJECT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: unknown; ts?: unknown };
    if (typeof v.id !== 'string' || !v.id) return null;
    if (typeof v.ts !== 'number' || Date.now() - v.ts > PENDING_TTL_MS) return null; // протух
    return v.id;
  } catch {
    return null; // легаси/битое значение — игнорируем
  }
}

/** Сбросить ключ без потребления (заход на список проектов — не копим). */
export function clearPendingProject(): void {
  try {
    sessionStorage.removeItem(PENDING_PROJECT_KEY);
  } catch {
    /* ignore */
  }
}

/** Демо-режим: проекты живут в памяти вкладки (как остальные mock-данные). */
const mockProjects: Project[] = [];

export const projectsApi = {
  async list(signal?: AbortSignal): Promise<Project[]> {
    if (USE_MOCK) {
      await delay(50);
      return clone(mockProjects);
    }
    return http<Project[]>('/projects', { signal });
  },

  async create(name: string): Promise<Project> {
    if (USE_MOCK) {
      await delay(80);
      const now = new Date().toISOString();
      const row: Project = { id: `proj_${Date.now()}`, name: name.trim(), createdAt: now, updatedAt: now, docsCount: 0 };
      mockProjects.unshift(row);
      return clone(row);
    }
    return http<Project>('/projects', { method: 'POST', body: { name } });
  },

  async rename(id: string, name: string): Promise<Project> {
    if (USE_MOCK) {
      await delay(60);
      const row = mockProjects.find((p) => p.id === id);
      if (!row) throw new ApiError('Project not found', 404);
      row.name = name.trim();
      row.updatedAt = new Date().toISOString();
      return clone(row);
    }
    return http<Project>(`/projects/${id}`, { method: 'PATCH', body: { name } });
  },

  /** Удаляет проект; документы НЕ удаляются — возвращаются в общий список. */
  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(80);
      const i = mockProjects.findIndex((p) => p.id === id);
      if (i >= 0) mockProjects.splice(i, 1);
      return;
    }
    await http<void>(`/projects/${id}`, { method: 'DELETE' });
  },
};
