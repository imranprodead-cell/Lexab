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
import { ApiError } from '@/api/util';
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
  if (t.startsWith('/draft')) return tStandalone('chat.mock.draft');
  if (t.startsWith('/compare')) return tStandalone('chat.mock.compare');
  if (t.startsWith('/translate')) return tStandalone('chat.mock.translate');
  return tStandalone('chat.mock.default');
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
  /** Ghost (incognito) mode: the conversation lives only in this tab's memory. */
  ghost: boolean;

  /** Enter ghost mode: the current canvas is stashed and restored on exit. */
  enterGhost: () => void;
  exitGhost: () => void;
  /** Thumbs rating on an assistant reply (optimistic; persisted outside ghost). */
  setFeedback: (messageId: string, value: 'up' | 'down' | null) => void;

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
function clearStepTimers() {
  stepTimers.forEach(clearTimeout);
  stepTimers = [];
}

/** Per-message typewriter timers + their full texts: a late or concurrent
 *  reply must never kill another message's animation. */
const streamTimers = new Map<string, ReturnType<typeof setInterval>>();
const streamFullTexts = new Map<string, string>();

/** Canvas generation counter: bumped on every canvas switch (ghost in/out,
 *  session load, reset). In-flight completions compare their captured epoch
 *  and drop their result instead of leaking it into the new canvas. */
let canvasEpoch = 0;

/** Canvas snapshot taken when entering ghost mode, restored on exit. */
let ghostStash: {
  phase: ChatPhase;
  messages: ChatMessage[];
  analysis: AnalysisResult | null;
  activeStep: number;
  serverSessionId: string | null;
} | null = null;

export const useChatStore = create<ChatState>((set, get) => {
  /** Once both the analysis and the server session exist, tie them together so
   *  the summary card is restored when the session is reopened (idempotent). */
  const tryLinkAnalysis = () => {
    const { analysis, serverSessionId } = get();
    if (USE_MOCK || !analysis || !serverSessionId) return;
    void chatsApi.linkAnalysis(serverSessionId, analysis.id).catch(() => undefined);
  };

  /** Reveal `full` a few characters at a time inside the assistant bubble. */
  const streamIn = (assistantId: string, full: string) => {
    const existing = streamTimers.get(assistantId);
    if (existing) clearInterval(existing);
    streamFullTexts.set(assistantId, full);
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(full.length, i + 3);
      const done = i >= full.length;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, text: full.slice(0, i), streaming: !done } : m,
        ),
      }));
      if (done) {
        clearInterval(timer);
        streamTimers.delete(assistantId);
        streamFullTexts.delete(assistantId);
      }
    }, 16);
    streamTimers.set(assistantId, timer);
  };

  /** Fast-forward every animating reply to its full text and drop reply
   *  placeholders whose request never returned. Runs on every canvas switch
   *  and before each outgoing message — nothing may stay streaming:true. */
  const finishActiveStreams = () => {
    const fulls = new Map(streamFullTexts);
    for (const timer of streamTimers.values()) clearInterval(timer);
    streamTimers.clear();
    streamFullTexts.clear();
    set((s) => ({
      messages: s.messages.flatMap((m) => {
        if (!m.streaming) return [m];
        const full = fulls.get(m.id);
        if (full !== undefined) return [{ ...m, streaming: false, text: full }];
        return m.text ? [{ ...m, streaming: false }] : []; // reply never arrived
      }),
    }));
  };

  return {
  phase: 'idle',
  messages: [],
  analysis: null,
  activeStep: -1,
  error: null,
  steps: ANALYSIS_STEPS,
  serverSessionId: null,
  ghost: false,

  enterGhost: () => {
    // No mode switch while an analysis is in flight — its completion would
    // land in the wrong canvas and the restored spinner would never resolve.
    if (get().ghost || get().phase === 'analyzing') return;
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
    const { phase, messages, analysis, activeStep, serverSessionId } = get();
    ghostStash = { phase, messages, analysis, activeStep, serverSessionId };
    set({ ghost: true, phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null, serverSessionId: null });
  },

  exitGhost: () => {
    if (!get().ghost) return;
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
    const restored = ghostStash;
    ghostStash = null;
    set({
      ghost: false,
      phase: restored?.phase ?? 'idle',
      messages: restored?.messages ?? [],
      analysis: restored?.analysis ?? null,
      activeStep: restored?.activeStep ?? -1,
      error: null,
      serverSessionId: restored?.serverSessionId ?? null,
    });
  },

  setFeedback: (messageId, value) => {
    const prev = get().messages.find((m) => m.id === messageId)?.feedback ?? null;
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)) }));
    const sessionId = get().serverSessionId;
    // Local-only rating: ghost/mock conversations and fallback replies whose
    // local ids (a_… / gm_…) the server never saw — a POST would only 404.
    if (get().ghost || USE_MOCK || !sessionId || messageId.startsWith('a_') || messageId.startsWith('gm_')) return;
    void chatsApi.setFeedback(sessionId, messageId, value).catch(() => {
      // Roll back only if the user has not changed the rating again meanwhile.
      set((s) => ({ messages: s.messages.map((m) => (m.id === messageId && m.feedback === value ? { ...m, feedback: prev } : m)) }));
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  startAnalysis: async (file, rawFile) => {
    if (get().phase === 'analyzing' || get().ghost) return; // no files in ghost mode
    const epoch = canvasEpoch;
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
      if (epoch !== canvasEpoch) return; // canvas switched meanwhile — drop
      clearStepTimers();
      set({
        phase: 'analyzed',
        analysis: result,
        activeStep: ANALYSIS_STEPS.length,
      });
      tryLinkAnalysis();
    } catch (err) {
      if (epoch !== canvasEpoch) return;
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
    finishActiveStreams();
    canvasEpoch++;
    ghostStash = null;
    set({ phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null, serverSessionId: null, ghost: false });
  },

  sendMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const epoch = canvasEpoch;
    // Fast-forward the previous reply's animation: history must carry its
    // full text and no message may linger in streaming state.
    finishActiveStreams();

    // Ghost mode: history is carried by the client, so capture the turns
    // BEFORE the new pair is appended.
    const ghostHistory = get().ghost
      ? get()
          .messages.filter((m) => m.kind === 'text' && m.text && !m.streaming)
          .slice(-10)
          .map((m) => ({ role: m.role, text: m.text as string }))
      : [];

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

    // A declined plan limit surfaces as a limit; any other failure surfaces as
    // an honest error — never a fabricated legal answer (a canned reply would
    // masquerade as real AI output in a legal product).
    const failReply = (err: unknown) => {
      if (err instanceof ApiError && err.status === 402) {
        streamIn(assistantId, tStandalone('chat.limitReached'));
        useUIStore.getState().pushToast(err.message, 'error');
        return;
      }
      const message = err instanceof ApiError && err.message ? err.message : tStandalone('chat.error');
      streamIn(assistantId, tStandalone('chat.error'));
      useUIStore.getState().pushToast(message, 'error');
    };

    // Ghost mode: same AI, same limits — no session, nothing persisted.
    if (get().ghost) {
      void (async () => {
        try {
          const reply = await chatsApi.sendGhostMessage(trimmed, ghostHistory, defaultLaw());
          if (epoch !== canvasEpoch) return; // canvas switched — drop the late reply
          streamIn(assistantId, reply.text ?? '');
        } catch (err) {
          if (epoch !== canvasEpoch) return;
          failReply(err);
        }
      })();
      return;
    }

    // Real backend: ensure a server-side chat session, then ask the AI.
    void (async () => {
      try {
        let sessionId = get().serverSessionId;
        if (!sessionId) {
          const title = get().analysis?.fileName ?? trimmed.slice(0, 60);
          const session = await chatsApi.create(title);
          if (epoch !== canvasEpoch) return;
          sessionId = session.id;
          set({ serverSessionId: sessionId });
          refreshHistory(); // the new chat shows up in the sidebar right away
        }
        // Ground the reply in the contract being reviewed (document Q&A).
        const reply = await chatsApi.sendMessage(sessionId, trimmed, get().analysis?.id, defaultLaw());
        if (epoch !== canvasEpoch) return; // canvas switched — drop the late reply
        // Adopt the server-side message id so follow-up actions (thumbs
        // rating) address the persisted row, not the temporary local id.
        set((s) => ({ messages: s.messages.map((m) => (m.id === assistantId ? { ...m, id: reply.id } : m)) }));
        streamIn(reply.id, reply.text ?? '');
        refreshHistory(); // bump the session to the top (updated_at changed)
      } catch (err) {
        if (epoch !== canvasEpoch) return;
        failReply(err);
      }
    })();
  },

  loadSession: async (sessionId) => {
    if (USE_MOCK) return;
    // Opening a saved session leaves ghost mode (its stash is superseded).
    if (get().ghost) {
      ghostStash = null;
      set({ ghost: false });
    }
    if (get().serverSessionId === sessionId) return; // already showing this one
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
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

  setServerSession: (id) => {
    if (get().ghost) return; // a late session id must not leak into ghost state
    set({ serverSessionId: id });
    tryLinkAnalysis();
  },

  // Documents page → "Open workspace": show that document's own analysis.
  adoptAnalysis: (analysis) => {
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
    ghostStash = null;
    set({
      ghost: false,
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
    tryLinkAnalysis();
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
    // On failure the optimistic change is rolled back — the UI must never
    // claim a decision the server did not store.
    if (status === 'accepted' || status === 'rejected') {
      void analysisApi.updateRedline(analysis.id, id, status).catch(() => {
        const a = get().analysis;
        if (a && a.id === analysis.id) {
          set({
            analysis: { ...a, redlines: a.redlines.map((r) => (r.id === id ? { ...r, status: 'pending' } : r)) },
          });
        }
        useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
      });
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
    void Promise.allSettled(
      pending.map((r) => analysisApi.updateRedline(analysis.id, r.id, 'accepted').then(() => r.id)),
    ).then((results) => {
      const failed = new Set(
        results.flatMap((res, i) => (res.status === 'rejected' ? [pending[i].id] : [])),
      );
      if (!failed.size) return;
      const a = get().analysis;
      if (a && a.id === analysis.id) {
        set({
          analysis: { ...a, redlines: a.redlines.map((r) => (failed.has(r.id) ? { ...r, status: 'pending' } : r)) },
        });
      }
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  pendingRedlineCount: () =>
    get().analysis?.redlines.filter((r) => r.status === 'pending').length ?? 0,

  updateDocument: (document) =>
    set((s) => {
      if (!s.analysis) return s;
      // A manual paragraph edit can drop {redlineId} slots — retire pending
      // suggestions that are no longer in the document (the server PATCH does
      // the same), so the "N suggestions" counters match what is visible.
      const referenced = new Set<string>();
      for (const b of document) {
        for (const seg of b.segments ?? []) {
          if (typeof seg !== 'string') referenced.add(seg.redlineId);
        }
      }
      return {
        analysis: {
          ...s.analysis,
          document,
          redlines: s.analysis.redlines.filter((r) => r.status !== 'pending' || referenced.has(r.id)),
        },
      };
    }),
  };
});
