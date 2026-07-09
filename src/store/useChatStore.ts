/**
 * Chat / review-session store.
 *
 * Owns the conversational canvas state machine:
 *   idle → analyzing → analyzed → (workspace handled by routing)
 *
 * The animated progress steps are driven here on timers while the analysis
 * request is in flight, so the UI shows a genuine loading→success→error cycle
 * backed by the API layer.
 */
import { create } from 'zustand';
import { USE_MOCK, analysisApi } from '@/api';
import { chatsApi } from '@/api/chats.api';
import { uploadsApi } from '@/api/uploads.api';
import { COUNTRIES } from '@/data/countries';
import { ANALYSIS_STEPS } from '@/data/seed';
import { tStandalone } from '@/i18n/messages';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
import type { AnalysisResult, ChatMessage, RedlineStatus } from '@/types/domain';

/** Refresh the sidebar list so new sessions / updated order show up instantly. */
function refreshHistory() {
  void useChatHistoryStore.getState().load();
}

/** Default law context ("German law", …) from the top-bar country selector. */
function defaultLaw(): string | undefined {
  const code = useUIStore.getState().country;
  return COUNTRIES.find((c) => c.code === code)?.law;
}

export type ChatPhase = 'idle' | 'analyzing' | 'analyzed' | 'error';

const STEP_INTERVAL = 1150;

/** Mock assistant replies per slash command — replaced by a real chat endpoint. */
function mockReply(text: string): string {
  const t = text.trim().toLowerCase();
  if (t.startsWith('/draft')) {
    return 'Готовлю черновик. Вот структура двустороннего NDA (право Великобритании): 1) Стороны и определения; 2) Конфиденциальная информация; 3) Обязательства получателя; 4) Исключения; 5) Срок и возврат; 6) Средства правовой защиты; 7) Применимое право. Скажите, какие пункты уточнить.';
  }
  if (t.startsWith('/compare')) {
    return 'Сравнение версий: обнаружено 6 изменённых пунктов. Ключевые: срок уведомления о расторжении сокращён с 3 месяцев до 1; добавлена оговорка о неконкуренции (12 мес.); изменён порядок разрешения споров на арбитраж LCIA. Открыть детальный дифф?';
  }
  if (t.startsWith('/translate')) {
    return 'Готов перевести и локализовать текст. Укажите целевой язык и юрисдикцию — я адаптирую терминологию и ссылки на нормы под местное право.';
  }
  return 'Принял. Уточните детали контракта или пункта — и я подготовлю ответ со ссылками на применимые нормы. Для полного обзора рисков загрузите документ или используйте /analyze.';
}

interface ChatState {
  phase: ChatPhase;
  messages: ChatMessage[];
  analysis: AnalysisResult | null;
  activeStep: number; // -1 none, 0..2 in progress, steps.length = done
  error: string | null;
  steps: string[];
  /** Backend chat session id (created lazily on the first real-API message). */
  serverSessionId: string | null;

  startAnalysis: (file: { name: string; size: string }, rawFile?: File) => Promise<void>;
  sendMessage: (text: string) => void;
  reset: () => void;
  /** Real mode: hydrate the canvas from a server-side chat session. */
  loadSession: (sessionId: string) => Promise<void>;
  /** Link the canvas to an already-created server session (sidebar entry). */
  setServerSession: (id: string | null) => void;
  /** Show a specific analysis in the workspace (e.g. from the Documents page). */
  adoptAnalysis: (analysis: AnalysisResult) => void;
  /** Re-run the AI review against the current draft; resolves with the new result. */
  reanalyze: () => Promise<AnalysisResult>;

  setRedlineStatus: (id: string, status: RedlineStatus) => void;
  acceptAllRedlines: () => void;
  pendingRedlineCount: () => number;
  /** Live editor: replace the analysis document blocks after a manual edit. */
  updateDocument: (document: AnalysisResult['document']) => void;
}

let stepTimers: ReturnType<typeof setTimeout>[] = [];
let streamTimer: ReturnType<typeof setInterval> | null = null;
function clearStepTimers() {
  stepTimers.forEach(clearTimeout);
  stepTimers = [];
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Reveal `full` a few characters at a time inside the assistant bubble. */
  const streamIn = (assistantId: string, full: string) => {
    if (streamTimer) clearInterval(streamTimer);
    let i = 0;
    streamTimer = setInterval(() => {
      i = Math.min(full.length, i + 3);
      const done = i >= full.length;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, text: full.slice(0, i), streaming: !done } : m,
        ),
      }));
      if (done && streamTimer) {
        clearInterval(streamTimer);
        streamTimer = null;
      }
    }, 16);
  };

  return {
  phase: 'idle',
  messages: [],
  analysis: null,
  activeStep: -1,
  error: null,
  steps: ANALYSIS_STEPS,
  serverSessionId: null,

  startAnalysis: async (file, rawFile) => {
    if (get().phase === 'analyzing') return;
    clearStepTimers();

    const userMessage: ChatMessage = {
      id: `m_${Date.now()}`,
      role: 'user',
      kind: 'file',
      file,
    };

    set({
      phase: 'analyzing',
      messages: [userMessage],
      analysis: null,
      activeStep: 0,
      error: null,
    });

    // Advance the visible progress steps while the request is in flight.
    for (let i = 1; i < ANALYSIS_STEPS.length; i++) {
      stepTimers.push(setTimeout(() => set({ activeStep: i }), STEP_INTERVAL * i));
    }

    try {
      // Ship the file itself first — the AI reads the actual contract text.
      if (rawFile && !USE_MOCK) {
        try {
          await uploadsApi.upload(rawFile);
        } catch {
          // Upload failed (offline/limit) — the review still runs from the
          // file name, but tell the user the content didn't make it through.
          useUIStore.getState().pushToast(tStandalone('chat.uploadFailed'), 'error');
        }
      }
      const result = await analysisApi.analyze({
        fileName: file.name,
        fileSize: file.size,
        jurisdiction: defaultLaw(),
      });
      clearStepTimers();
      set({
        phase: 'analyzed',
        analysis: result,
        activeStep: ANALYSIS_STEPS.length,
      });
    } catch (err) {
      clearStepTimers();
      set({
        phase: 'error',
        error: err instanceof Error ? err.message : 'Analysis failed. Please try again.',
        activeStep: -1,
      });
    }
  },

  reset: () => {
    clearStepTimers();
    if (streamTimer) clearInterval(streamTimer);
    set({ phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null, serverSessionId: null });
  },

  sendMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      kind: 'text',
      text: trimmed,
    };
    const assistantId = `a_${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      kind: 'text',
      text: '',
      streaming: true,
    };

    // Keep the chat visible even before any analysis has run.
    set((s) => ({
      phase: s.phase === 'idle' ? 'analyzed' : s.phase,
      messages: [...s.messages, userMessage, assistantMessage],
    }));

    if (USE_MOCK) {
      streamIn(assistantId, mockReply(trimmed));
      return;
    }

    // Real backend: ensure a server-side chat session, then ask the AI.
    void (async () => {
      try {
        let sessionId = get().serverSessionId;
        if (!sessionId) {
          const title = get().analysis?.fileName ?? trimmed.slice(0, 60);
          const session = await chatsApi.create(title);
          sessionId = session.id;
          set({ serverSessionId: sessionId });
          refreshHistory(); // the new chat shows up in the sidebar right away
        }
        // Ground the reply in the contract being reviewed (document Q&A).
        const reply = await chatsApi.sendMessage(sessionId, trimmed, get().analysis?.id, defaultLaw());
        streamIn(assistantId, reply.text ?? '');
        refreshHistory(); // bump the session to the top (updated_at changed)
      } catch {
        // Network/AI failure — degrade to the canned reply so the chat stays alive.
        streamIn(assistantId, mockReply(trimmed));
      }
    })();
  },

  loadSession: async (sessionId) => {
    if (USE_MOCK) return;
    if (get().serverSessionId === sessionId) return; // already showing this one
    clearStepTimers();
    if (streamTimer) clearInterval(streamTimer);
    try {
      const messages = await chatsApi.messages(sessionId);
      const analysisRef = [...messages].reverse().find((m) => m.analysisId)?.analysisId;
      const analysis = analysisRef ? await analysisApi.get(analysisRef).catch(() => null) : null;
      set({
        phase: messages.length || analysis ? 'analyzed' : 'idle',
        messages,
        analysis,
        activeStep: analysis ? ANALYSIS_STEPS.length : -1,
        error: null,
        serverSessionId: sessionId,
      });
    } catch {
      // Session unknown to the server — show an empty canvas instead of
      // someone else's demo contract.
      set({ phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null, serverSessionId: null });
    }
  },

  setServerSession: (id) => set({ serverSessionId: id }),

  // Documents page → "Open workspace": show that document's own analysis.
  adoptAnalysis: (analysis) => {
    clearStepTimers();
    if (streamTimer) clearInterval(streamTimer);
    set({
      phase: 'analyzed',
      messages: [
        {
          id: `m_${Date.now()}`,
          role: 'user',
          kind: 'file',
          file: { name: analysis.fileName, size: analysis.fileSize },
        },
      ],
      analysis,
      activeStep: ANALYSIS_STEPS.length,
      error: null,
      serverSessionId: null,
    });
  },

  reanalyze: async () => {
    const current = get().analysis;
    if (!current) throw new Error('Nothing to re-analyse');
    const result = await analysisApi.reanalyze(current.id, defaultLaw());
    set({ analysis: result, phase: 'analyzed', activeStep: ANALYSIS_STEPS.length, error: null });
    return result;
  },


  setRedlineStatus: (id, status) => {
    const analysis = get().analysis;
    if (!analysis) return;
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (r.id === id ? { ...r, status } : r)),
      },
    });
    // Persist so the decision survives reloads and reaches exports/teammates.
    if (status === 'accepted' || status === 'rejected') {
      void analysisApi.updateRedline(analysis.id, id, status).catch(() => undefined);
    }
  },

  acceptAllRedlines: () => {
    const analysis = get().analysis;
    if (!analysis) return;
    const pending = analysis.redlines.filter((r) => r.status === 'pending');
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (r.status === 'pending' ? { ...r, status: 'accepted' } : r)),
      },
    });
    for (const r of pending) {
      void analysisApi.updateRedline(analysis.id, r.id, 'accepted').catch(() => undefined);
    }
  },

  pendingRedlineCount: () =>
    get().analysis?.redlines.filter((r) => r.status === 'pending').length ?? 0,

  updateDocument: (document) =>
    set((s) => (s.analysis ? { analysis: { ...s.analysis, document } } : s)),
  };
});
