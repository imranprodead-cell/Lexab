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
import type { AnalysisResult, ChatMessage, DocBlock, RedlineStatus } from '@/types/domain';
import { isRedlineSlot } from '@/types/domain';

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
  /** A saved session is being fetched (uncached open) — show a skeleton. */
  sessionLoading: boolean;
  /** Ghost (incognito) mode: the conversation lives only in this tab's memory. */
  ghost: boolean;
  /** Redline id to jump to when the workspace opens (set from the chat summary
   *  card's "click a finding"); consumed and cleared by the workspace. */
  pendingAnchor: string | null;

  /** Request the workspace to open at the clause fixed by this redline. */
  requestAnchor: (redlineId: string) => void;
  clearPendingAnchor: () => void;

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
  /** Accept every pending redline; returns the ids flipped (for a 5s Undo). */
  acceptAllRedlines: () => string[];
  /** Send the given redlines back to pending (Accept-all undo). */
  revertRedlines: (ids: string[]) => void;
  pendingRedlineCount: () => number;
  /** Live editor: replace the analysis document blocks after a manual edit.
   *  `snapshot` (default true) records an undo step; undo/redo pass false. */
  updateDocument: (document: AnalysisResult['document'], snapshot?: boolean) => void;

  /** Toggle whether AI tracked changes (redlines) are shown or hidden. */
  showEdits: boolean;
  toggleShowEdits: () => void;
  /** Undo/redo stacks (editor toolbar). Each snapshot captures BOTH the blocks
   *  and the redline states, so undo can't resurrect a retired redline slot. */
  docUndo: DocSnapshot[];
  docRedo: DocSnapshot[];
  /** Revert / re-apply the last document edit; persists the swapped blocks. */
  undoDocument: () => void;
  redoDocument: () => void;
}

interface DocSnapshot {
  document: DocBlock[];
  redlines: AnalysisResult['redlines'];
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

/** Replies still in flight, keyed by server session id. Lets the user leave a
 *  chat mid-generation and find the reply streaming in when they come back —
 *  the model keeps working in the background instead of the answer vanishing. */
const pendingReplies = new Map<string, string>(); // sessionId → placeholder message id

/** Placeholder ids whose reply is streaming live from the server (real SSE, not
 *  the fake typewriter). finishActiveStreams leaves these alone — they are
 *  genuinely still generating, not stale animations to fast-forward or drop. */
const liveStreamIds = new Set<string>();

/** Last known conversation per session (stale-while-revalidate): reopening a
 *  chat paints instantly from this cache while fresh data loads behind it.
 *  LRU-capped — a long session hopping between many chats (each with a full
 *  analysis document) must not grow memory without bound. */
const SESSION_CACHE_MAX = 30;
const sessionCache = new Map<string, { messages: ChatMessage[]; analysis: AnalysisResult | null }>();
function cacheSession(id: string, value: { messages: ChatMessage[]; analysis: AnalysisResult | null }) {
  sessionCache.delete(id); // re-insert → becomes the most recently used
  sessionCache.set(id, value);
  while (sessionCache.size > SESSION_CACHE_MAX) {
    sessionCache.delete(sessionCache.keys().next().value as string); // evict the oldest
  }
}

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

  /** Live-token painter: accumulate deltas from an SSE reply and flush them into
   *  the message with `targetId` at most every ~50ms — but ONLY if that message
   *  still exists in the current canvas. That one guard covers epoch switches
   *  (id gone → nothing paints) and leave-and-return (loadSession restores the
   *  placeholder → the next flush catches it up to everything streamed while
   *  the user was away). The model's own cadence IS the typewriter here. */
  const makeLivePainter = (targetId: string) => {
    let acc = '';
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      scheduled = null;
      set((s) =>
        s.messages.some((m) => m.id === targetId)
          ? { messages: s.messages.map((m) => (m.id === targetId ? { ...m, text: acc, streaming: true } : m)) }
          : {},
      );
    };
    return {
      onToken: (delta: string) => {
        acc += delta;
        if (!scheduled) scheduled = setTimeout(flush, 50);
      },
      cancel: () => {
        if (scheduled) {
          clearTimeout(scheduled);
          scheduled = null;
        }
      },
    };
  };

  /** Fast-forward every animating reply to its full text and drop reply
   *  placeholders whose request never returned. Runs on every canvas switch
   *  and before each outgoing message — nothing may stay streaming:true.
   *  Live SSE replies are skipped: they are still generating server-side. */
  const finishActiveStreams = () => {
    const fulls = new Map(streamFullTexts);
    for (const timer of streamTimers.values()) clearInterval(timer);
    streamTimers.clear();
    streamFullTexts.clear();
    set((s) => ({
      messages: s.messages.flatMap((m) => {
        if (!m.streaming) return [m];
        if (liveStreamIds.has(m.id)) return [m]; // genuinely still streaming from the server
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
  sessionLoading: false,
  ghost: false,
  pendingAnchor: null,
  showEdits: true,
  docUndo: [],
  docRedo: [],

  requestAnchor: (redlineId) => set({ pendingAnchor: redlineId }),
  clearPendingAnchor: () => set({ pendingAnchor: null }),

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
      const sessionAtCall = get().serverSessionId;
      const result = await analysisApi.analyze({
        fileName: file.name,
        fileSize: file.size,
        jurisdiction: defaultLaw(),
      });
      // Persist the session↔analysis link NO MATTER which canvas is visible —
      // otherwise an analysis finished in the background is never restorable
      // and its sidebar chat opens empty. (Idempotent server-side.)
      const linkSid = sessionAtCall ?? get().serverSessionId;
      if (linkSid && !USE_MOCK) void chatsApi.linkAnalysis(linkSid, result.id).catch(() => undefined);
      if (epoch !== canvasEpoch) {
        // Canvas switched while analysing. If the user came back to the same
        // session, adopt the finished result; otherwise it stays persisted
        // server-side and is restored when the session is reopened.
        if (sessionAtCall && get().serverSessionId === sessionAtCall) {
          clearStepTimers();
          set({ phase: 'analyzed', analysis: result, activeStep: ANALYSIS_STEPS.length, error: null });
          tryLinkAnalysis();
        }
        return;
      }
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
      // The sidebar session was created optimistically FOR this analysis. If
      // nothing was ever persisted into it (no text messages), remove it —
      // otherwise a failed/limited analysis leaves a dead chat that opens empty.
      const deadSid = get().serverSessionId;
      const hasText = get().messages.some((m) => m.kind === 'text');
      if (deadSid && !hasText && !USE_MOCK) {
        set({ serverSessionId: null });
        void chatsApi
          .remove(deadSid)
          .then(() => refreshHistory())
          .catch(() => undefined);
      }
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
        const painter = makeLivePainter(assistantId);
        liveStreamIds.add(assistantId);
        try {
          const reply = await chatsApi.sendGhostMessage(trimmed, ghostHistory, defaultLaw(), painter.onToken);
          painter.cancel();
          liveStreamIds.delete(assistantId);
          if (epoch !== canvasEpoch) return; // canvas switched — drop the late reply
          // Finalize with the authoritative server text — no fake typewriter.
          set((s) => ({
            messages: s.messages.map((m) => (m.id === assistantId ? { ...m, text: reply.text ?? '', streaming: false } : m)),
          }));
        } catch (err) {
          painter.cancel();
          liveStreamIds.delete(assistantId);
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
        // Tokens stream live into the placeholder as the model writes them.
        pendingReplies.set(sessionId, assistantId);
        liveStreamIds.add(assistantId);
        const painter = makeLivePainter(assistantId);
        const reply = await chatsApi.sendMessage(sessionId, trimmed, get().analysis?.id, defaultLaw(), painter.onToken);
        painter.cancel();
        pendingReplies.delete(sessionId);
        liveStreamIds.delete(assistantId);
        if (epoch === canvasEpoch) {
          // Adopt the server-side message id (so thumbs rating hits the
          // persisted row) and drop in the authoritative final text.
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, id: reply.id, text: reply.text ?? '', streaming: false } : m,
            ),
          }));
        } else if (get().serverSessionId === sessionId) {
          // The user left and came back to this chat while the model worked:
          // reuse the placeholder loadSession restored (or append one) and
          // drop the finished reply into it.
          set((s) => {
            if (s.messages.some((m) => m.id === assistantId)) {
              return {
                messages: s.messages.map((m) =>
                  m.id === assistantId ? { ...m, id: reply.id, text: reply.text ?? '', streaming: false } : m,
                ),
              };
            }
            return {
              messages: [
                ...s.messages,
                { id: reply.id, role: 'assistant' as const, kind: 'text' as const, text: reply.text ?? '', streaming: false },
              ],
            };
          });
        }
        // Another canvas is open: nothing to draw — the reply is persisted
        // server-side and appears when that chat is reopened.
        refreshHistory(); // bump the session to the top (updated_at changed)
      } catch (err) {
        const sid = get().serverSessionId;
        for (const [k, v] of pendingReplies) if (v === assistantId) pendingReplies.delete(k);
        liveStreamIds.delete(assistantId);
        if (epoch === canvasEpoch) {
          failReply(err);
        } else if (sid && get().messages.some((m) => m.id === assistantId)) {
          failReply(err); // restored placeholder — resolve it honestly
        }
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
    // Snapshot the canvas we're leaving, so coming back paints instantly.
    const leaving = get();
    if (leaving.serverSessionId && leaving.messages.length) {
      cacheSession(leaving.serverSessionId, { messages: leaving.messages, analysis: leaving.analysis });
    }
    canvasEpoch++;
    const epoch = canvasEpoch;

    // A reply for this session may still be generating in the background —
    // restore its "thinking" placeholder so the stream lands visibly.
    const withPending = (msgs: ChatMessage[]): ChatMessage[] => {
      const pendingId = pendingReplies.get(sessionId);
      return pendingId && !msgs.some((m) => m.id === pendingId)
        ? [...msgs, { id: pendingId, role: 'assistant' as const, kind: 'text' as const, text: '', streaming: true }]
        : msgs;
    };

    // Paint IMMEDIATELY: the cached conversation if we have one (revalidated
    // below), otherwise an empty canvas with a loading skeleton — the click
    // must never feel dead while the network round-trips run.
    const cached = sessionCache.get(sessionId);
    set({
      phase: cached ? 'analyzed' : 'idle',
      messages: cached ? withPending(cached.messages) : [],
      analysis: cached?.analysis ?? null,
      activeStep: cached?.analysis ? ANALYSIS_STEPS.length : -1,
      error: null,
      serverSessionId: sessionId,
      sessionLoading: !cached,
    });

    try {
      const messages = await chatsApi.messages(sessionId);
      if (epoch !== canvasEpoch) return;
      // Stage 1: the conversation shows as soon as it arrives — the analysis
      // card (a second round-trip) attaches right after.
      set({
        phase: messages.length ? 'analyzed' : 'idle',
        messages: withPending(messages),
        sessionLoading: false,
      });
      const analysisRef = [...messages].reverse().find((m) => m.analysisId)?.analysisId;
      const analysis = analysisRef ? await analysisApi.get(analysisRef).catch(() => null) : null;
      cacheSession(sessionId, { messages, analysis });
      if (epoch !== canvasEpoch) return;
      set({
        phase: messages.length || analysis ? 'analyzed' : 'idle',
        analysis,
        activeStep: analysis ? ANALYSIS_STEPS.length : -1,
      });
    } catch {
      if (epoch !== canvasEpoch) return;
      // Session unknown to the server — show an empty canvas instead of
      // someone else's demo contract.
      set({ phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null, serverSessionId: null, sessionLoading: false });
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
      // A freshly opened document starts with a clean edit history.
      docUndo: [],
      docRedo: [],
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
    // Remember the status we're leaving, so a failed persist rolls back to it
    // (not blindly to 'pending' — reverting an accepted change that fails must
    // return to 'accepted', not silently discard the earlier decision).
    const prev = analysis.redlines.find((r) => r.id === id)?.status ?? 'pending';
    if (prev === status) return;
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (r.id === id ? { ...r, status } : r)),
      },
    });
    // Persist EVERY transition (accept, reject, and revert-to-pending) so the
    // decision survives reloads and reaches exports/teammates. On failure the
    // optimistic change rolls back — the UI must never claim a state the
    // server did not store.
    void analysisApi.updateRedline(analysis.id, id, status).catch(() => {
      const a = get().analysis;
      if (a && a.id === analysis.id) {
        set({
          analysis: { ...a, redlines: a.redlines.map((r) => (r.id === id ? { ...r, status: prev } : r)) },
        });
      }
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  acceptAllRedlines: () => {
    const analysis = get().analysis;
    if (!analysis) return [];
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
    // Hand back the ids we flipped so the caller can offer a 5s Undo.
    return pending.map((r) => r.id);
  },

  /** Undo: send the given redlines back to 'pending' (used by the Accept-all
   *  undo toast). Persists each revert; a failed one is left accepted. */
  revertRedlines: (ids) => {
    const analysis = get().analysis;
    if (!analysis || !ids.length) return;
    const idSet = new Set(ids);
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (idSet.has(r.id) ? { ...r, status: 'pending' } : r)),
      },
    });
    void Promise.allSettled(
      ids.map((id) => analysisApi.updateRedline(analysis.id, id, 'pending').then(() => id)),
    ).then((results) => {
      const failed = new Set(results.flatMap((res, i) => (res.status === 'rejected' ? [ids[i]] : [])));
      if (!failed.size) return;
      const a = get().analysis;
      if (a && a.id === analysis.id) {
        set({
          analysis: { ...a, redlines: a.redlines.map((r) => (failed.has(r.id) ? { ...r, status: 'accepted' } : r)) },
        });
      }
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  pendingRedlineCount: () =>
    get().analysis?.redlines.filter((r) => r.status === 'pending').length ?? 0,

  updateDocument: (document, snapshot = true) =>
    set((s) => {
      if (!s.analysis) return s;
      // A manual paragraph edit can drop {redlineId} slots — retire pending
      // suggestions that are no longer in the document (the server PATCH does
      // the same), so the "N suggestions" counters match what is visible.
      const referenced = new Set<string>();
      for (const b of document) {
        for (const seg of b.segments ?? []) {
          if (isRedlineSlot(seg)) referenced.add(seg.redlineId);
        }
      }
      const before: DocSnapshot = { document: s.analysis.document, redlines: s.analysis.redlines };
      return {
        analysis: {
          ...s.analysis,
          document,
          redlines: s.analysis.redlines.filter((r) => r.status !== 'pending' || referenced.has(r.id)),
        },
        // Record the pre-edit state so Undo restores both blocks AND redlines.
        docUndo: snapshot ? [...s.docUndo, before].slice(-50) : s.docUndo,
        docRedo: snapshot ? [] : s.docRedo,
      };
    }),

  toggleShowEdits: () => set((s) => ({ showEdits: !s.showEdits })),

  undoDocument: () => {
    const s = get();
    if (!s.analysis || s.docUndo.length === 0) return;
    const prev = s.docUndo[s.docUndo.length - 1];
    const current: DocSnapshot = { document: s.analysis.document, redlines: s.analysis.redlines };
    set({
      analysis: { ...s.analysis, document: prev.document, redlines: prev.redlines },
      docUndo: s.docUndo.slice(0, -1),
      docRedo: [...s.docRedo, current].slice(-50),
    });
    void persistDocument(get().analysis!.id, prev.document);
  },

  redoDocument: () => {
    const s = get();
    if (!s.analysis || s.docRedo.length === 0) return;
    const next = s.docRedo[s.docRedo.length - 1];
    const current: DocSnapshot = { document: s.analysis.document, redlines: s.analysis.redlines };
    set({
      analysis: { ...s.analysis, document: next.document, redlines: next.redlines },
      docRedo: s.docRedo.slice(0, -1),
      docUndo: [...s.docUndo, current].slice(-50),
    });
    void persistDocument(get().analysis!.id, next.document);
  },
  };
});

/** Persist swapped document blocks (undo/redo); surface a toast on failure. */
function persistDocument(analysisId: string, document: DocBlock[]): Promise<void> {
  return analysisApi
    .saveDocument(analysisId, document)
    .then(() => undefined)
    .catch(() => useUIStore.getState().pushToast(tStandalone('common.error'), 'error'));
}
