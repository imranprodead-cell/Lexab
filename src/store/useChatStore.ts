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
import { ANALYSIS_STEPS, DEMO_ANALYSIS } from '@/data/seed';
import type { AnalysisResult, ChatMessage, RedlineStatus } from '@/types/domain';

export type ChatPhase = 'idle' | 'analyzing' | 'analyzed' | 'error';

const DEFAULT_FILE = { name: 'Employment_Agreement_v3.docx', size: '48 KB' };
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

  startAnalysis: (file?: { name: string; size: string }) => Promise<void>;
  sendMessage: (text: string) => void;
  reset: () => void;
  seedAnalyzed: () => void;
  /** Real mode: hydrate the canvas from a server-side chat session. */
  loadSession: (sessionId: string) => Promise<void>;

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

  startAnalysis: async (file = DEFAULT_FILE) => {
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
      const result = await analysisApi.analyze({
        fileName: file.name,
        fileSize: file.size,
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
        }
        // Ground the reply in the contract being reviewed (document Q&A).
        const reply = await chatsApi.sendMessage(sessionId, trimmed, get().analysis?.id);
        streamIn(assistantId, reply.text ?? '');
      } catch {
        // Network/AI failure — degrade to the canned reply so the chat stays alive.
        streamIn(assistantId, mockReply(trimmed));
      }
    })();
  },

  loadSession: async (sessionId) => {
    if (USE_MOCK) {
      get().seedAnalyzed();
      return;
    }
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
      // Session unknown to the server (e.g. seeded demo id) — show the demo state.
      get().seedAnalyzed();
    }
  },

  // Used when landing directly on the workspace route (e.g. deep link / refresh).
  seedAnalyzed: () => {
    if (get().analysis) return;
    set({
      phase: 'analyzed',
      messages: [{ id: 'seed', role: 'user', kind: 'file', file: DEFAULT_FILE }],
      analysis: { ...DEMO_ANALYSIS, redlines: DEMO_ANALYSIS.redlines.map((r) => ({ ...r })) },
      activeStep: ANALYSIS_STEPS.length,
      error: null,
    });
  },

  setRedlineStatus: (id, status) =>
    set((s) => {
      if (!s.analysis) return s;
      return {
        analysis: {
          ...s.analysis,
          redlines: s.analysis.redlines.map((r) => (r.id === id ? { ...r, status } : r)),
        },
      };
    }),

  acceptAllRedlines: () =>
    set((s) => {
      if (!s.analysis) return s;
      return {
        analysis: {
          ...s.analysis,
          redlines: s.analysis.redlines.map((r) =>
            r.status === 'pending' ? { ...r, status: 'accepted' } : r,
          ),
        },
      };
    }),

  pendingRedlineCount: () =>
    get().analysis?.redlines.filter((r) => r.status === 'pending').length ?? 0,

  updateDocument: (document) =>
    set((s) => (s.analysis ? { analysis: { ...s.analysis, document } } : s)),
  };
});
