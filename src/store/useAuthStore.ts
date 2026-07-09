/**
 * Authentication store.
 *
 * Real mode (VITE_USE_MOCK_API=false): login/register call the backend
 * (/auth/login, /auth/register) and persist the returned JWT + profile.
 * Mock mode: any well-formed credentials succeed (original prototype behaviour).
 */
import { create } from 'zustand';
import { USE_MOCK } from '@/api/client';
import { authApi } from '@/api/auth.api';
import { CURRENT_USER } from '@/data/seed';
import { clearAsyncCache } from '@/hooks/useAsync';
import { useNotificationsStore } from '@/store/useNotificationsStore';
import type { UserProfile } from '@/types/domain';

const STORAGE_KEY = 'lexai.auth';

interface Session {
  token: string;
  user: UserProfile;
}

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  status: 'idle' | 'loading';
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  /** Accept a ready-made session (e.g. returned by the Google OAuth callback). */
  adoptSession: (token: string, user: UserProfile) => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  logout: () => void;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function persist(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Simulated auth backend (mock mode only). Accepts any well-formed credentials. */
async function mockAuth(user: UserProfile): Promise<Session> {
  await new Promise((r) => setTimeout(r, 250));
  return { token: `mock_${Date.now()}`, user };
}

const existing = loadSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: existing?.user ?? null,
  token: existing?.token ?? null,
  status: 'idle',

  login: async (email, password) => {
    set({ status: 'loading' });
    try {
      const session = USE_MOCK
        ? await mockAuth({ ...CURRENT_USER, email })
        : await authApi.login(email, password);
      clearAsyncCache();
      useNotificationsStore.getState().reset();
      persist(session);
      set({ user: session.user, token: session.token, status: 'idle' });
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }
  },

  register: async (name, email, password) => {
    set({ status: 'loading' });
    try {
      const session = USE_MOCK
        ? await mockAuth({ ...CURRENT_USER, name, email, initials: initials(name), firm: 'LexAI' })
        : await authApi.register(name, email, password);
      clearAsyncCache();
      useNotificationsStore.getState().reset();
      persist(session);
      set({ user: session.user, token: session.token, status: 'idle' });
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }
  },

  adoptSession: (token, user) => {
    clearAsyncCache();
    useNotificationsStore.getState().reset();
    persist({ token, user });
    set({ user, token, status: 'idle' });
  },

  logout: () => {
    // Best-effort server-side token invalidation; local sign-out regardless.
    if (!USE_MOCK && get().token) void authApi.logout().catch(() => undefined);
    clearAsyncCache();
    useNotificationsStore.getState().reset();
    persist(null);
    set({ user: null, token: null });
  },

  updateProfile: (patch) =>
    set((s) => {
      if (!s.user) return s;
      const user = { ...s.user, ...patch };
      if (s.token) persist({ token: s.token, user });
      return { user };
    }),
}));
