/** Chat sessions API — powers the recent-reviews list in the sidebar. */
import type { ChatMessage, ChatSession } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { db } from './mock/db';
import { clone, delay } from './util';

export const chatsApi = {
  async list(archived = false, signal?: AbortSignal): Promise<ChatSession[]> {
    if (USE_MOCK) {
      await delay(40);
      return archived ? [] : clone(db.sessions);
    }
    return http<ChatSession[]>(`/chats?archived=${archived}`, { signal });
  },

  /** Rename / pin / archive a session. */
  async update(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<ChatSession> {
    if (USE_MOCK) {
      await delay(120);
      const s = db.sessions.find((x) => x.id === id);
      if (s && patch.title) s.title = patch.title;
      return clone(s ?? { id, title: patch.title ?? '', updatedAt: new Date().toISOString() });
    }
    return http<ChatSession>(`/chats/${id}`, { method: 'PATCH', body: patch });
  },

  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(120);
      const i = db.sessions.findIndex((x) => x.id === id);
      if (i >= 0) db.sessions.splice(i, 1);
      return;
    }
    await http<void>(`/chats/${id}`, { method: 'DELETE' });
  },

  async messages(sessionId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
    if (USE_MOCK) {
      await delay(40);
      return [];
    }
    return http<ChatMessage[]>(`/chats/${sessionId}/messages`, { signal });
  },

  /** Tie a finished analysis to the session so its summary card survives a
   *  reopen from the sidebar (idempotent on the server). */
  async linkAnalysis(sessionId: string, analysisId: string): Promise<ChatMessage[]> {
    if (USE_MOCK) {
      await delay(40);
      return [];
    }
    return http<ChatMessage[]>(`/chats/${sessionId}/analysis-ref`, { method: 'POST', body: { analysisId } });
  },

  async create(title: string): Promise<ChatSession> {
    if (USE_MOCK) {
      await delay(150);
      const session: ChatSession = {
        id: `c_${Date.now()}`,
        title,
        updatedAt: new Date().toISOString(),
      };
      db.sessions.unshift(session);
      return clone(session);
    }
    return http<ChatSession>('/chats', { method: 'POST', body: { title } });
  },

  /** Send a user message; the server persists it and returns the AI reply.
   *  Pass `analysisId` to ground the reply in that contract (document Q&A);
   *  `jurisdiction` sets the default law context from the country selector. */
  async sendMessage(sessionId: string, text: string, analysisId?: string, jurisdiction?: string): Promise<ChatMessage> {
    return http<ChatMessage>(`/chats/${sessionId}/messages`, {
      method: 'POST',
      body: { text, ...(analysisId ? { analysisId } : {}), ...(jurisdiction ? { jurisdiction } : {}) },
    });
  },
};
