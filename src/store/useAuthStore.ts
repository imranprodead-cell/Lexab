/**
 * Authentication store.
 *
 * Real mode (VITE_USE_MOCK_API=false): login calls the backend and persists
 * the returned JWT + profile; register only creates the account — the session
 * starts after the emailed confirmation link is clicked (see VerifyEmailPage).
 * Mock mode: any well-formed credentials succeed (original prototype behaviour).
 */
import { create } from 'zustand';
import { SESSION_EXPIRED_EVENT, USE_MOCK } from '@/api/client';
import { authApi, type TwoFactorCredential } from '@/api/auth.api';
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
  /** The last sign-out was forced by an expired/revoked token — the login
   *  screen shows a "session expired" notice instead of a bare form. */
  sessionExpired: boolean;
  /** `twoFactor` is the second factor supplied after a `totp_required` challenge. */
  login: (email: string, password: string, twoFactor?: TwoFactorCredential) => Promise<void>;
  /** Resolves to 'verify-email' when the account awaits mailbox confirmation. */
  register: (name: string, email: string, password: string) => Promise<'signed-in' | 'verify-email'>;
  /** Accept a ready-made session (e.g. returned by the Google OAuth callback). */
  adoptSession: (token: string, user: UserProfile) => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  logout: () => void;
  /** Silently exchange the token for a fresh one once past half its lifetime,
   *  so an account that visits at least once a month never gets signed out. */
  refreshSessionIfNeeded: () => Promise<void>;
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

/** Mock-mode profile derived from the entered credentials — no seeded persona. */
function mockProfile(name: string, email: string): UserProfile {
  return { name, initials: initials(name), firm: 'LexAI', jurisdiction: 'United Kingdom', email };
}

/** iat/exp (seconds) from a JWT payload, or null for opaque/mock tokens. */
function tokenTimes(token: string): { iat: number; exp: number } | null {
  try {
    const part = token.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { iat?: number; exp?: number };
    return typeof payload.iat === 'number' && typeof payload.exp === 'number'
      ? { iat: payload.iat, exp: payload.exp }
      : null;
  } catch {
    return null;
  }
}

/** Past half the token's lifetime (or already expired — the server then answers
 *  401 and the session-expired listener routes to the login screen). */
export function shouldRefreshToken(token: string, nowMs = Date.now()): boolean {
  const times = tokenTimes(token);
  if (!times) return false;
  return nowMs / 1000 > times.iat + (times.exp - times.iat) / 2;
}

let refreshInFlight = false;

const existing = loadSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: existing?.user ?? null,
  token: existing?.token ?? null,
  status: 'idle',
  sessionExpired: false,

  login: async (email, password, twoFactor) => {
    set({ status: 'loading' });
    try {
      const session = USE_MOCK
        ? await mockAuth(mockProfile(email.split('@')[0] || email, email))
        : await authApi.login(email, password, twoFactor);
      clearAsyncCache();
      useNotificationsStore.getState().reset();
      persist(session);
      set({ user: session.user, token: session.token, status: 'idle', sessionExpired: false });
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }
  },

  register: async (name, email, password) => {
    set({ status: 'loading' });
    try {
      if (USE_MOCK) {
        const session = await mockAuth(mockProfile(name, email));
        clearAsyncCache();
        useNotificationsStore.getState().reset();
        persist(session);
        set({ user: session.user, token: session.token, status: 'idle' });
        return 'signed-in';
      }
      // The account is created, but signing in requires the emailed link —
      // otherwise anyone could register with someone else's address.
      await authApi.register(name, email, password);
      // Drop the "session expired" notice: the "check your mailbox" one that
      // follows sign-up must not stack on top of it.
      set({ status: 'idle', sessionExpired: false });
      return 'verify-email';
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }
  },

  adoptSession: (token, user) => {
    clearAsyncCache();
    useNotificationsStore.getState().reset();
    persist({ token, user });
    set({ user, token, status: 'idle', sessionExpired: false });
  },

  logout: () => {
    // Best-effort server-side token invalidation; local sign-out regardless.
    if (!USE_MOCK && get().token) void authApi.logout().catch(() => undefined);
    clearAsyncCache();
    useNotificationsStore.getState().reset();
    persist(null);
    set({ user: null, token: null, sessionExpired: false });
  },

  refreshSessionIfNeeded: async () => {
    const { token, user } = get();
    if (USE_MOCK || !token || !user || refreshInFlight) return;
    if (!shouldRefreshToken(token)) return;
    refreshInFlight = true;
    try {
      const session = await authApi.refresh();
      // Swap the token ONLY (if the user didn't sign out mid-flight). The
      // profile is deliberately left alone: adopting the server snapshot here
      // could silently revert a profile edit saved while the call was in flight.
      if (get().token === token) {
        const current = get().user;
        if (current) persist({ token: session.token, user: current });
        set({ token: session.token });
      }
    } catch {
      // Network failure → keep the current token and retry later (fail-open).
      // A 401 is already handled globally by the session-expired listener.
    } finally {
      refreshInFlight = false;
    }
  },

  updateProfile: (patch) =>
    set((s) => {
      if (!s.user) return s;
      const user = { ...s.user, ...patch };
      if (s.token) persist({ token: s.token, user });
      return { user };
    }),
}));

// A 401 from any API call means the stored token is dead (expired or revoked):
// drop the session so RequireAuth routes to the login screen, and flag it so
// that screen explains WHY instead of showing a bare form.
if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_EXPIRED_EVENT, (e) => {
    const current = useAuthStore.getState().token;
    if (!current) return; // already signed out
    // The event names the token the FAILED request carried. If the store holds
    // a different one, the session was already replaced (e.g. a background
    // poll lost the race against a password change) — the new session stands.
    const failed = (e as CustomEvent<{ token?: string }>).detail?.token;
    if (failed && failed !== current) return;
    clearAsyncCache();
    useNotificationsStore.getState().reset();
    persist(null);
    useAuthStore.setState({ user: null, token: null, sessionExpired: true });
  });

  // Cross-tab sync via the shared localStorage key: a sign-out in one tab
  // signs the others out QUIETLY (it was deliberate — no "session expired"
  // notice), and a sign-in/refresh hands the newest session to every tab.
  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    let next: Session | null = null;
    try {
      next = e.key === null ? null : (JSON.parse(e.newValue ?? 'null') as Session | null);
    } catch {
      return; // corrupt value from another tab — ignore
    }
    const s = useAuthStore.getState();
    if (!next) {
      if (!s.token) return;
      clearAsyncCache();
      useNotificationsStore.getState().reset();
      useAuthStore.setState({ user: null, token: null, sessionExpired: false });
      return;
    }
    if (next.token === s.token) return;
    clearAsyncCache();
    useNotificationsStore.getState().reset();
    useAuthStore.setState({ user: next.user, token: next.token, sessionExpired: false });
  });

  // Silent renewal: on app open, when the tab becomes visible again (wake from
  // sleep), and hourly while it stays open.
  if (!USE_MOCK) {
    const kick = () => void useAuthStore.getState().refreshSessionIfNeeded();
    kick();
    window.setInterval(kick, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') kick();
    });
  }
}
