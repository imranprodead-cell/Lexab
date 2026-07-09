/**
 * Notifications store.
 *
 * Real mode: hydrates from GET /notifications — the server records events
 * (analysis ready, sent for signature, team invites) — and persists read-state
 * via POST /notifications/read, so the red badge stays cleared across devices
 * until genuinely new events arrive.
 * Mock mode: seeded items with read-state kept in localStorage.
 */
import { create } from 'zustand';
import { USE_MOCK } from '@/api/client';
import { notificationsApi } from '@/api/notifications.api';

export interface AppNotification {
  id: string;
  icon: 'esign' | 'check' | 'alert' | 'docs';
  title: string;
  titleEn?: string | null;
  /** Dim detail line under the title (file name, sender, …). */
  body?: string | null;
  bodyEn?: string | null;
  /** 'team_invite' (data = invite token) or 'open' (data = app path). */
  actionKind?: string;
  actionData?: string;
  time: string;
  createdAt?: string;
  read: boolean;
}

interface NotificationsState {
  items: AppNotification[];
  unread: () => number;
  /** (Re)load the feed from the server. No-op in mock mode. */
  load: () => Promise<void>;
  /** Force-refresh, ignoring the freshness window (after accepting an invite). */
  refresh: () => Promise<void>;
  /** Login/logout: drop the previous account's feed so nothing leaks across. */
  reset: () => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  add: (n: Omit<AppNotification, 'id' | 'read' | 'time'>) => void;
}

const STORAGE_KEY = 'lexai.notifications';

const seed: AppNotification[] = [
  { id: 'n1', icon: 'esign', title: 'NDA — mutual: документ подписан', time: '2 ч назад', read: false },
  { id: 'n2', icon: 'check', title: 'Анализ Employment_Agreement_v3 готов', time: '5 ч назад', read: false },
  { id: 'n3', icon: 'alert', title: 'Supplier_Terms_2026: найден высокий риск', time: 'Вчера', read: true },
];

function loadMockItems(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppNotification[];
  } catch {
    /* corrupted storage — fall back to the seed */
  }
  return seed;
}

function persistMock(items: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage full/blocked — state stays in memory */
  }
}

/** Skip refetching when the last load is fresher than this. */
const LOAD_TTL_MS = 15_000;
let lastLoadedAt = 0;

export const useNotificationsStore = create<NotificationsState>((set, get) => {
  const apply = (items: AppNotification[]) => {
    if (USE_MOCK) persistMock(items);
    set({ items });
  };

  return {
    items: USE_MOCK ? loadMockItems() : [],

    unread: () => get().items.filter((n) => !n.read).length,

    load: async () => {
      if (USE_MOCK) return;
      if (Date.now() - lastLoadedAt < LOAD_TTL_MS) return;
      try {
        const items = await notificationsApi.list();
        lastLoadedAt = Date.now();
        set({ items });
      } catch {
        /* not signed in / offline — keep whatever we have */
      }
    },

    refresh: async () => {
      lastLoadedAt = 0;
      await get().load();
    },

    reset: () => {
      lastLoadedAt = 0;
      set({ items: USE_MOCK ? loadMockItems() : [] });
    },

    markAllRead: () => {
      apply(get().items.map((n) => ({ ...n, read: true })));
      if (!USE_MOCK) void notificationsApi.markRead().catch(() => undefined);
    },

    markRead: (id) => {
      apply(get().items.map((n) => (n.id === id ? { ...n, read: true } : n)));
      if (!USE_MOCK) void notificationsApi.markRead(id).catch(() => undefined);
    },

    add: (n) => apply([{ ...n, id: `n_${Date.now()}`, read: false, time: 'Только что' }, ...get().items]),
  };
});
