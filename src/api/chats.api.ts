/** Chat sessions API — powers the recent-reviews list in the sidebar. */
import type { ChatMessage, ChatSession, ChatStep, PlanProgress } from '@/types/domain';
import { USE_MOCK, http, httpSSE, StreamingUnsupportedError } from './client';
import { db } from './mock/db';
import { clone, delay } from './util';

/** Тестовый режим: отметки плана — в браузере (сервера нет). */
const MOCK_PROGRESS_KEY = 'lexai.mock.planProgress';
function readMockProgress(sessionId: string): PlanProgress | null {
  try {
    const raw = localStorage.getItem(`${MOCK_PROGRESS_KEY}.${sessionId}`);
    return raw ? (JSON.parse(raw) as PlanProgress) : null;
  } catch {
    return null;
  }
}

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
   *  `jurisdiction` sets the default law context from the country selector.
   *  With `onToken`, the reply streams live (SSE); without it, a plain POST. */
  async sendMessage(
    sessionId: string,
    text: string,
    analysisId?: string,
    jurisdiction?: string,
    onToken?: (delta: string) => void,
    draft?: { title: string; content: string },
    /** Файлы, прикреплённые к этому вопросу (id загрузок). */
    uploadIds?: string[],
    /** Шаги работы над ответом — по мере выполнения на сервере. */
    onStep?: (step: ChatStep) => void,
  ): Promise<ChatMessage> {
    const body = {
      text,
      ...(analysisId ? { analysisId } : {}),
      ...(jurisdiction ? { jurisdiction } : {}),
      // Сохранённый черновик: анализа нет, контекстом служит сам текст документа.
      ...(draft ? { draftTitle: draft.title, draftText: draft.content } : {}),
      ...(uploadIds?.length ? { uploadIds } : {}),
    };
    if (onToken && !USE_MOCK) {
      try {
        return await httpSSE<ChatMessage>(`/chats/${sessionId}/messages`, body, onToken, (event, payload) => {
          if (event === 'step' && onStep) onStep(payload as ChatStep);
        });
      } catch (err) {
        // ONLY the pre-send feature-detect falls back to a plain POST; a
        // mid-stream failure must not re-POST (the server may have already
        // persisted the turn + reply — a resend would duplicate them).
        if (!(err instanceof StreamingUnsupportedError)) throw err;
      }
    }
    return http<ChatMessage>(`/chats/${sessionId}/messages`, { method: 'POST', body });
  },

  /** Отметки шагов одобренного плана этого чата (null — отметок нет). */
  async getProgress(sessionId: string, signal?: AbortSignal): Promise<PlanProgress | null> {
    if (USE_MOCK) return readMockProgress(sessionId);
    const res = await http<Partial<PlanProgress>>(`/chats/${sessionId}/progress`, { signal });
    return res.messageId && Array.isArray(res.done) ? { messageId: res.messageId, done: res.done } : null;
  },

  async saveProgress(sessionId: string, progress: PlanProgress): Promise<PlanProgress> {
    if (USE_MOCK) {
      try {
        localStorage.setItem(`${MOCK_PROGRESS_KEY}.${sessionId}`, JSON.stringify(progress));
      } catch {
        /* тестовый режим без хранилища — отметки живут до перезагрузки */
      }
      return progress;
    }
    return http<PlanProgress>(`/chats/${sessionId}/progress`, { method: 'PUT', body: progress });
  },

  /** Rate an assistant reply (thumbs up / down); `null` clears the rating. */
  async setFeedback(sessionId: string, messageId: string, value: 'up' | 'down' | null): Promise<void> {
    if (USE_MOCK) {
      await delay(60);
      return;
    }
    await http(`/chats/${sessionId}/messages/${messageId}/feedback`, { method: 'POST', body: { value } });
  },
};
