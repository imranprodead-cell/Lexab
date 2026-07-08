/**
 * Notifications store (mock). Seeds a few events and exposes read-state.
 * A real backend would hydrate this from GET /notifications + a socket.
 */
import { create } from 'zustand';

export interface AppNotification {
  id: string;
  icon: 'esign' | 'check' | 'alert' | 'docs';
  title: string;
  time: string;
  read: boolean;
}

interface NotificationsState {
  items: AppNotification[];
  unread: () => number;
  markAllRead: () => void;
  markRead: (id: string) => void;
  add: (n: Omit<AppNotification, 'id' | 'read' | 'time'>) => void;
}

const seed: AppNotification[] = [
  { id: 'n1', icon: 'esign', title: 'NDA — mutual: документ подписан', time: '2 ч назад', read: false },
  { id: 'n2', icon: 'check', title: 'Анализ Employment_Agreement_v3 готов', time: '5 ч назад', read: false },
  { id: 'n3', icon: 'alert', title: 'Supplier_Terms_2026: найден высокий риск', time: 'Вчера', read: true },
];

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: seed,
  unread: () => get().items.filter((n) => !n.read).length,
  markAllRead: () => set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),
  markRead: (id) => set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
  add: (n) =>
    set((s) => ({
      items: [{ ...n, id: `n_${Date.now()}`, read: false, time: 'Только что' }, ...s.items],
    })),
}));
