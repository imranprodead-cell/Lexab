/**
 * Global UI store: rail expansion, accent theming, reduce-motion, toasts.
 * Persists user preferences (accent, motion, rail pin) to localStorage.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'lexai.ui.prefs';

/** 'default' = графитовый акцент темы (цвет чернил, задан токенами в
 *  global.css и сам переключается вместе с темой). Явный hex — пользовательское
 *  переопределение, пишется инлайном на <html>. */
export const ACCENT_DEFAULT = 'default';
export const ACCENT_OPTIONS = [ACCENT_DEFAULT, '#5b8def', '#3fb8af', '#e0666b'] as const;

/** Прежний фиолетовый дефолт — мигрируется в 'default' при чтении prefs. */
const LEGACY_ACCENT = '#8b7cf6';

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
    const prefs = { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) };
    // Редизайн: прежний фиолетовый дефолт становится графитом темы.
    if (prefs.accent === LEGACY_ACCENT) prefs.accent = ACCENT_DEFAULT;
    return prefs;
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

/** Apply theme prefs to the document root as CSS variables / class / attrs. */
export function applyTheme(prefs: Pick<Prefs, 'accent' | 'reduceMotion' | 'theme'>) {
  const root = document.documentElement;
  if (prefs.accent === ACCENT_DEFAULT) {
    // Графит темы: значение приходит из токенов global.css и меняется
    // вместе с .dark — инлайн-переопределение снимаем.
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
  } else {
    root.style.setProperty('--accent', prefs.accent);
    root.style.setProperty('--on-accent', '#0c0c10');
  }
  root.setAttribute('data-reduce-motion', String(prefs.reduceMotion));
  root.classList.toggle('dark', resolveTheme(prefs.theme) === 'dark');
}

/* Плавный кросс-фейд при смене темы: класс theme-switching включает узкий
   набор transition (см. global.css) и снимается после завершения. */
let themeSwitchTimer: ReturnType<typeof setTimeout> | null = null;
function beginThemeTransition() {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  if (themeSwitchTimer) clearTimeout(themeSwitchTimer);
  themeSwitchTimer = setTimeout(() => {
    root.classList.remove('theme-switching');
    themeSwitchTimer = null;
  }, 420);
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
    if (!get().reduceMotion) beginThemeTransition();
    set({ theme });
    applyTheme({ accent: get().accent, reduceMotion: get().reduceMotion, theme });
    persist(snapshot(get(), { theme }));
  },

  toggleTheme: () => {
    // Binary toggle (command palette, auth page): flip to the opposite palette.
    const theme: Theme = resolveTheme(get().theme) === 'dark' ? 'light' : 'dark';
    if (!get().reduceMotion) beginThemeTransition();
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
