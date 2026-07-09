/**
 * Chat history store (the sidebar list + Archive page).
 *
 * Real mode: sessions live on the server (GET/POST/PATCH/DELETE /chats) —
 * pin, rename, archive and delete persist across devices.
 * Mock mode: seeds from the demo list + localStorage, actions are local-only.
 */
import { create } from 'zustand';
import { USE_MOCK } from '@/api/client';
import { chatsApi } from '@/api/chats.api';
import { CHAT_SESSIONS } from '@/data/seed';
import { tStandalone } from '@/i18n/messages';
import { useUIStore } from '@/store/useUIStore';
import type { ChatSession } from '@/types/domain';

const STORAGE_KEY = 'lexai.chats';
const META_KEY = 'lexai.chats.meta';

/** How long the "Undo" window stays open before a chat is really deleted. */
const UNDO_DELETE_MS = 5000;

/* ── Mock-mode persistence (original prototype behaviour) ─────────────────── */

interface HistoryMeta {
  pinned: string[];
  archived: string[];
  deleted: string[];
  renamed: Record<string, string>;
}

const EMPTY_META: HistoryMeta = { pinned: [], archived: [], deleted: [], renamed: {} };

function loadAdded(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatSession[]) : [];
  } catch {
    return [];
  }
}

function persistAdded(added: ChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(added));
  } catch {
    /* ignore */
  }
}

function loadMeta(): HistoryMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? { ...EMPTY_META, ...(JSON.parse(raw) as Partial<HistoryMeta>) } : { ...EMPTY_META };
  } catch {
    return { ...EMPTY_META };
  }
}

function persistMeta(meta: HistoryMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

function mockVisible(added: ChatSession[], meta: HistoryMeta): ChatSession[] {
  const hidden = new Set([...meta.archived, ...meta.deleted]);
  return [...added, ...CHAT_SESSIONS]
    .filter((s) => !hidden.has(s.id))
    .map((s) => (meta.renamed[s.id] ? { ...s, title: meta.renamed[s.id] } : s));
}

/* ── Store ─────────────────────────────────────────────────────────────────── */

interface ChatHistoryState {
  sessions: ChatSession[];
  /** Ids of pinned sessions (shown in their own group on top). */
  pinned: string[];
  /** (Re)load the sidebar list. Call on app start and after auth changes. */
  load: () => Promise<void>;
  addSession: (title: string) => Promise<ChatSession | null>;
  togglePin: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  archiveSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

export const useChatHistoryStore = create<ChatHistoryState>((set, get) => {
  const applyMockMeta = (mutate: (meta: HistoryMeta) => void) => {
    const meta = loadMeta();
    mutate(meta);
    persistMeta(meta);
    set({ sessions: mockVisible(loadAdded(), meta), pinned: meta.pinned });
  };

  const refresh = async () => {
    const sessions = await chatsApi.list(false);
    set({ sessions, pinned: sessions.filter((s) => s.pinned).map((s) => s.id) });
  };

  /** Run a server mutation, then refresh; errors are swallowed after a refresh
   *  so the sidebar never gets stuck out of sync. */
  const mutate = (action: () => Promise<unknown>) => {
    void action()
      .catch(() => undefined)
      .then(() => refresh())
      .catch(() => undefined);
  };

  const initialMeta = loadMeta();

  return {
    sessions: USE_MOCK ? mockVisible(loadAdded(), initialMeta) : [],
    pinned: USE_MOCK ? initialMeta.pinned : [],

    load: async () => {
      if (USE_MOCK) return;
      try {
        await refresh();
      } catch {
        /* not signed in yet / server down — sidebar just stays empty */
      }
    },

    addSession: async (title) => {
      const cleaned = title.replace(/\.[^.]+$/, '');
      if (USE_MOCK) {
        const session: ChatSession = { id: `c_${Date.now()}`, title: cleaned, updatedAt: new Date().toISOString() };
        persistAdded([session, ...loadAdded()]);
        applyMockMeta(() => {});
        return session;
      }
      try {
        const session = await chatsApi.create(cleaned || tStandalone('nav.newReview'));
        await refresh();
        return session;
      } catch {
        return null;
      }
    },

    togglePin: (id) => {
      if (USE_MOCK) {
        applyMockMeta((meta) => {
          meta.pinned = meta.pinned.includes(id) ? meta.pinned.filter((p) => p !== id) : [id, ...meta.pinned];
        });
        return;
      }
      const isPinned = get().pinned.includes(id);
      mutate(() => chatsApi.update(id, { pinned: !isPinned }));
    },

    renameSession: (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (USE_MOCK) {
        applyMockMeta((meta) => {
          meta.renamed[id] = trimmed;
        });
        return;
      }
      mutate(() => chatsApi.update(id, { title: trimmed }));
    },

    archiveSession: (id) => {
      if (USE_MOCK) {
        applyMockMeta((meta) => {
          if (!meta.archived.includes(id)) meta.archived.push(id);
          meta.pinned = meta.pinned.filter((p) => p !== id);
        });
        return;
      }
      mutate(() => chatsApi.update(id, { archived: true, pinned: false }));
    },

    deleteSession: (id) => {
      // Hide the chat immediately, but give the user a 5-second undo window
      // before it is actually deleted (toast with an "Undo" button).
      const prevSessions = get().sessions;
      const prevPinned = get().pinned;
      set({
        sessions: prevSessions.filter((s) => s.id !== id),
        pinned: prevPinned.filter((p) => p !== id),
      });

      const finalize = () => {
        if (USE_MOCK) {
          applyMockMeta((meta) => {
            if (!meta.deleted.includes(id)) meta.deleted.push(id);
            meta.pinned = meta.pinned.filter((p) => p !== id);
          });
          return;
        }
        mutate(() => chatsApi.remove(id));
      };
      const timer = setTimeout(finalize, UNDO_DELETE_MS);

      useUIStore.getState().pushToast(tStandalone('rail.deleting'), 'default', {
        duration: UNDO_DELETE_MS,
        actionLabel: tStandalone('common.undo'),
        onAction: () => {
          clearTimeout(timer);
          set({ sessions: prevSessions, pinned: prevPinned });
          useUIStore.getState().pushToast(tStandalone('rail.deleteCancelled'), 'success');
        },
      });
    },
  };
});
