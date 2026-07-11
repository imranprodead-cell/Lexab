/**
 * Global UI store: rail expansion, accent theming, reduce-motion, toasts.
 * Persists user preferences (accent, motion, rail pin) to localStorage.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'lexai.ui.prefs';

export const ACCENT_OPTIONS = ['#8b7cf6', '#5b8def', '#3fb8af', '#e0666b'] as const;

export type Theme = 'dark' | 'light' | 'system';

export interface Toast {
  id: string;
  message: string;
  tone: 'default' | 'success' | 'error';
  /** Optional action button ("Undo") rendered on the right of the toast. */
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay in ms (default 3200). */
  duration?: number;
}

interface Prefs {
  accent: string;
  reduceMotion: boolean;
  railPinned: boolean;
  theme: Theme;
  country: string; // ISO code, e.g. "GB"
}

interface UIState extends Prefs {
  railHovered: boolean;
  /** Phone-only overlay drawer state — ephemeral, never persisted, so it
   *  never inherits the desktop dock state when the viewport narrows. */
  mobileNavOpen: boolean;
  toasts: Toast[];
  setRailHovered: (v: boolean) => void;
  toggleRailPinned: () => void;
  setRailPinned: (v: boolean) => void;
  setMobileNavOpen: (v: boolean) => void;
  setAccent: (hex: string) => void;
  setReduceMotion: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setCountry: (code: string) => void;
  pushToast: (message: string, tone?: Toast['tone'], options?: ToastOptions) => void;
  dismissToast: (id: string) => void;
  /** Mouse over a toast: freeze its auto-dismiss until the cursor leaves. */
  holdToast: (id: string) => void;
  releaseToast: (id: string) => void;
  railOpen: () => boolean;
}

/** Countries available in the selector (must match data/countries.ts). */
const KNOWN_COUNTRIES = ['US', 'GB', 'DE', 'CA', 'KZ', 'UZ', 'AE'];

/** First visit: pick the country from the browser locale (en-US → US, …).
 *  Once the user picks one themselves it persists and this never runs again. */
function detectCountry(): string {
  try {
    const locales = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
    for (const locale of locales) {
      const region = locale.split('-')[1]?.toUpperCase();
      if (region && KNOWN_COUNTRIES.includes(region)) return region;
    }
  } catch {
    /* default below */
  }
  return 'GB';
}

function loadPrefs(): Prefs {
  const fallback: Prefs = {
    accent: ACCENT_OPTIONS[0],
    reduceMotion: false,
    // Desktop: sidebar docked open on first visit; narrow screens start closed.
    // Persisted the moment the user toggles it, so their choice sticks.
    railPinned: typeof window !== 'undefined' ? window.innerWidth > 700 : true,
    theme: 'light',
    country: detectCountry(),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return fallback;
  }
}

function persist(prefs: Prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Auto-dismiss bookkeeping per toast (paused while the cursor is on it). */
const toastTimers = new Map<
  string,
  { timeout: ReturnType<typeof setTimeout> | null; expiresAt: number; remaining: number }
>();

/** Resolve the theme preference to an actual palette.
 *  "system" is the standard look and intentionally equals light. */
function resolveTheme(theme: Theme): 'dark' | 'light' {
  return theme === 'dark' ? 'dark' : 'light';
}

/** Apply theme prefs to the document root as CSS variables / data attrs. */
export function applyTheme(prefs: Pick<Prefs, 'accent' | 'reduceMotion' | 'theme'>) {
  const root = document.documentElement;
  root.style.setProperty('--accent', prefs.accent);
  root.setAttribute('data-reduce-motion', String(prefs.reduceMotion));
  root.setAttribute('data-theme', resolveTheme(prefs.theme));
}

const initial = loadPrefs();
applyTheme(initial);

/** Pull just the persistable prefs out of state, with an optional override. */
function snapshot(state: Prefs, override: Partial<Prefs> = {}): Prefs {
  return {
    accent: state.accent,
    reduceMotion: state.reduceMotion,
    railPinned: state.railPinned,
    theme: state.theme,
    country: state.country,
    ...override,
  };
}

export const useUIStore = create<UIState>((set, get) => ({
  ...initial,
  railHovered: false,
  mobileNavOpen: false,
  toasts: [],

  setRailHovered: (v) => set({ railHovered: v }),

  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

  toggleRailPinned: () => {
    const railPinned = !get().railPinned;
    set({ railPinned });
    persist(snapshot(get(), { railPinned }));
  },

  setRailPinned: (railPinned) => {
    if (get().railPinned === railPinned) return;
    set({ railPinned });
    persist(snapshot(get(), { railPinned }));
  },

  setAccent: (accent) => {
    set({ accent });
    applyTheme({ accent, reduceMotion: get().reduceMotion, theme: get().theme });
    persist(snapshot(get(), { accent }));
  },

  setReduceMotion: (reduceMotion) => {
    set({ reduceMotion });
    applyTheme({ accent: get().accent, reduceMotion, theme: get().theme });
    persist(snapshot(get(), { reduceMotion }));
  },

  setTheme: (theme) => {
    set({ theme });
    applyTheme({ accent: get().accent, reduceMotion: get().reduceMotion, theme });
    persist(snapshot(get(), { theme }));
  },

  toggleTheme: () => {
    // Binary toggle (command palette, auth page): flip to the opposite palette.
    const theme: Theme = resolveTheme(get().theme) === 'dark' ? 'light' : 'dark';
    set({ theme });
    applyTheme({ accent: get().accent, reduceMotion: get().reduceMotion, theme });
    persist(snapshot(get(), { theme }));
  },

  setCountry: (country) => {
    set({ country });
    persist(snapshot(get(), { country }));
  },

  pushToast: (message, tone = 'default', options = {}) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const { actionLabel, onAction, duration = 3200 } = options;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone, actionLabel, onAction }] }));
    toastTimers.set(id, {
      timeout: setTimeout(() => get().dismissToast(id), duration),
      expiresAt: Date.now() + duration,
      remaining: duration,
    });
  },

  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer?.timeout) clearTimeout(timer.timeout);
    toastTimers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  // Hover pauses the countdown; leaving resumes it from where it stopped
  // (the initial 3–4 s lifetime is unchanged when nobody hovers).
  holdToast: (id) => {
    const timer = toastTimers.get(id);
    if (!timer?.timeout) return;
    clearTimeout(timer.timeout);
    timer.timeout = null;
    timer.remaining = Math.max(timer.expiresAt - Date.now(), 600);
  },

  releaseToast: (id) => {
    const timer = toastTimers.get(id);
    if (!timer || timer.timeout) return;
    timer.expiresAt = Date.now() + timer.remaining;
    timer.timeout = setTimeout(() => get().dismissToast(id), timer.remaining);
  },

  railOpen: () => get().railPinned || get().railHovered,
}));
