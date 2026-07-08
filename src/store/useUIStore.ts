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
  toasts: Toast[];
  setRailHovered: (v: boolean) => void;
  toggleRailPinned: () => void;
  setAccent: (hex: string) => void;
  setReduceMotion: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setCountry: (code: string) => void;
  pushToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;
  railOpen: () => boolean;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = {
    accent: ACCENT_OPTIONS[0],
    reduceMotion: false,
    railPinned: false,
    theme: 'light',
    country: 'GB',
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

/** Resolve the "system" preference to an actual palette via matchMedia. */
function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
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

// Re-apply on OS theme change while the user is on "system".
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    try {
      const prefs = loadPrefs();
      if (prefs.theme === 'system') applyTheme(prefs);
    } catch {
      /* ignore */
    }
  });
}

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
  toasts: [],

  setRailHovered: (v) => set({ railHovered: v }),

  toggleRailPinned: () => {
    const railPinned = !get().railPinned;
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
    // Binary toggle from the top bar: resolve current, flip to the opposite.
    const current = get().theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : get().theme;
    const theme: Theme = current === 'dark' ? 'light' : 'dark';
    set({ theme });
    applyTheme({ accent: get().accent, reduceMotion: get().reduceMotion, theme });
    persist(snapshot(get(), { theme }));
  },

  setCountry: (country) => {
    set({ country });
    persist(snapshot(get(), { country }));
  },

  pushToast: (message, tone = 'default') => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  railOpen: () => get().railPinned || get().railHovered,
}));
