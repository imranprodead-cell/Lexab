import type { CSSProperties, ReactNode } from 'react';

/**
 * Icon set — 24×24 stroke icons ported from the Lexab prototype. Rendered as
 * inline SVG so they inherit `currentColor` and can be sized freely.
 * Each entry is the SVG geometry (paths / rects / circles) for that glyph.
 */
const GEOMETRY: Record<string, ReactNode> = {
  chat: <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.5L3.5 20l1-4.6a8.5 8.5 0 1 1 16-3.9Z" />,
  compose: (
    <>
      <path d="M12 4.5H6.5a2 2 0 0 0-2 2V17.5a2 2 0 0 0 2 2H18a2 2 0 0 0 2-2V12" />
      <path d="M18.4 3.6a2 2 0 0 1 2.8 2.8l-7.7 7.7-3.6.8.8-3.6Z" />
    </>
  ),
  docs: (
    <>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z" />
      <path d="M13.5 3.5V9H19M9 13h6M9 16.5h6" />
    </>
  ),
  /* Папка (раздел «Проекты» — дела юриста): стиль остальных stroke-глифов. */
  folder: (
    <path d="M3.5 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l.9 1.2a2 2 0 0 0 1.6.8h5.3a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  ),
  layout: (
    <>
      <rect x="4" y="4.5" width="16" height="6" rx="1.8" />
      <rect x="4" y="13.5" width="7" height="6" rx="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6" rx="1.8" />
    </>
  ),
  esign: (
    <>
      <path d="M14.5 5 19 9.5 8.5 20H4v-4.5Z" />
      <path d="m12.5 7 4.5 4.5" />
    </>
  ),
  pen: (
    <>
      <path d="M14.5 5 19 9.5 8.5 20H4v-4.5Z" />
      <path d="m12.5 7 4.5 4.5" />
    </>
  ),
  analytics: <path d="M4.5 19.5h15M7.5 16v-4.5M12 16V6.5M16.5 16V9" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  attach: (
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  ),
  send: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  x: <path d="m5.5 5.5 13 13m0-13-13 13" />,
  /* Derived from the reference UploadIcon (vertical mirror of the arrow,
     same arrowhead metrics, bar stays at the bottom) — no DownloadIcon exists
     in the design reference. */
  download: <path d="M12 4V15.5m0 0 4.5-4.5M12 15.5 7.5 11M4.5 19.5h15" />,
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 21 19.5H3Z" />
      <path d="M12 10v4M12 16.8h.01" />
    </>
  ),
  diamond: <path d="M12 3 21 12 12 21 3 12z" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </>
  ),
  trash: <path d="M4.5 6.5h15M9.5 6V4.5h5V6M6.5 6.5l.9 13h9.2l.9-13M10 10.5v5.5M14 10.5v5.5" />,
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 18.6a6.6 6.6 0 0 0 0-13.2v13.2z" fill="currentColor" stroke="none" />
    </>
  ),
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5" />
    </>
  ),
  translate: (
    <path d="M3.5 6h9M8 3.5V6m2.5 0c-1 4.5-3.9 8-7 9.8M5.8 9.5c1.3 3.4 4 6 6.7 7.3M12.5 20.5l4.5-10 4.5 10M14.3 16.5h5.4" />
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.2 9.8a5.8 5.8 0 0 1 11.6 0c0 3.7 1.4 5.2 1.4 5.2H4.8s1.4-1.5 1.4-5.2Z" />
      <path d="M10.2 18.5a2 2 0 0 0 3.6 0" />
    </>
  ),
  command: <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  menuAlt: (
    <>
      <path d="M4 9h16" />
      <path d="M4 15h9" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5M15.8 5a3.2 3.2 0 0 1 0 6.2M17.3 14.7c2 .6 3.3 2 3.7 4.3" />
    </>
  ),
  upload: <path d="M12 15.5V4m0 0 4.5 4.5M12 4 7.5 8.5M4.5 19.5h15" />,
  /* Reference ChevronDownIcon proportions, rotated to point right / left. */
  chevron: <path d="m9.5 6 6 6-6 6" />,
  back: <path d="m14.5 6-6 6 6 6" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 4.5 13.8 10 19.5 12l-5.7 2-1.8 5.5L10.2 14 4.5 12l5.7-2Z" />
      <path d="M19 3.5v3M17.5 5h3" />
    </>
  ),
  thumbsUp: (
    <>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </>
  ),
  thumbsDown: (
    <>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="14" height="14" rx="3.5" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  ghost: (
    <>
      <path d="M12 3.5a7 7 0 0 0-7 7v9.5l2.4-1.9 2.3 1.9 2.3-1.9 2.3 1.9 2.3-1.9L19 20v-9.5a7 7 0 0 0-7-7Z" />
      <path d="M9.5 10.5h.01M14.5 10.5h.01" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  filter: (
    <>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.4 3 8.4 7 9.5 4-1.1 7-5.1 7-9.5V6Z" />
      <path d="m9.2 11.8 2 2 3.6-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  /* Документ со стрелкой наружу — «открыть файл» (карточки шаблонов и т.п.). */
  fileOpen: (
    <path d="M14.5 4.5H20V10M19.5 4.9 11.5 13M9.5 5.5H6.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
  ),
  eyeOff: (
    <>
      <path d="M4 4.5 20 19.5M9.9 6.4A9.4 9.4 0 0 1 12 6.2c4.2 0 7.6 2.7 9.5 5.8-.7 1.1-1.6 2.2-2.7 3.1M6.3 8.1c-1.6 1.1-2.9 2.5-3.8 3.9 1.9 3.1 5.3 5.8 9.5 5.8 1.1 0 2.1-.2 3.1-.5" />
      <path d="M9.5 11.9a2.6 2.6 0 0 0 3 2.7" />
    </>
  ),
  /* Глифы эталона (icons.tsx): Lock/Server/Key/Message — для секции
     «Безопасность» и карточки «Вопросы к документу». */
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4.5" width="17" height="6.5" rx="2" />
      <rect x="3.5" y="13" width="17" height="6.5" rx="2" />
      <path d="M7 7.75h.01M7 16.25h.01" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4" />
      <path d="m11 12.5 8.5-8.5M16.5 7l2.5 2.5M13.8 9.7l2 2" />
    </>
  ),
  message: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1-4.6A8.5 8.5 0 1 1 20.5 12Z" />
      <path d="M8.5 11h7M8.5 14h4.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12.5h-5.5l-2 3h-5l-2-3H2" />
      <path d="M5.45 5.61 2 12.5V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.5l-3.45-6.89A2 2 0 0 0 16.76 4.5H7.24a2 2 0 0 0-1.79 1.11Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15.5" rx="2.5" />
      <path d="M4 10h16M8.5 3v4M15.5 3v4" />
    </>
  ),
  cloud: <path d="M7 18a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.5 11 3.6 3.6 0 0 1 18 18Z" />,
  gdrive: (
    <>
      <path d="m9.3 4 h5.4 L22 16.2 19.3 20.5 H4.7 L2 16.2z" />
      <path d="M9.3 4 4.7 20.5M14.7 4 8.6 15.5M22 16.2 H8.6" />
    </>
  ),
  ms365: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  dropbox: (
    <>
      <path d="m12 6.7-5-3.2-5 3.2 5 3.2zM22 6.7l-5-3.2-5 3.2 5 3.2zM12 13.1 7 9.9l-5 3.2 5 3.2zM22 13.1l-5-3.2-5 3.2 5 3.2z" />
      <path d="m7.5 17.6 4.5 2.9 4.5-2.9" />
    </>
  ),
  // ── Rich-text editor toolbar ─────────────────────────────────────────────
  bold: (
    <>
      <path d="M7 4h6a4 4 0 0 1 0 8H7z" />
      <path d="M7 12h7a4 4 0 0 1 0 8H7z" />
    </>
  ),
  italic: (
    <>
      <path d="M19 4h-9" />
      <path d="M14 20H5" />
      <path d="m15 4-6 16" />
    </>
  ),
  underline: (
    <>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <path d="M5 21h14" />
    </>
  ),
  strikethrough: (
    <>
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <path d="M4 12h16" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>
  ),
  listNumbered: (
    <>
      <path d="M10 6h11" />
      <path d="M10 12h11" />
      <path d="M10 18h11" />
      <path d="M4 5h1v4" />
      <path d="M4 9h2" />
      <path d="M4 15.5c0-.8 2-.8 2 .3s-2 1.4-2 2.2h2" />
    </>
  ),
  alignLeft: (
    <>
      <path d="M3 6h18" />
      <path d="M3 12h12" />
      <path d="M3 18h15" />
    </>
  ),
  alignCenter: (
    <>
      <path d="M3 6h18" />
      <path d="M6 12h12" />
      <path d="M4 18h16" />
    </>
  ),
  alignRight: (
    <>
      <path d="M3 6h18" />
      <path d="M9 12h12" />
      <path d="M6 18h15" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.7 13.4 6.6 3.8" />
      <path d="M15.3 6.8 8.7 10.6" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H10" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H14" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88" />
      <path d="M14.47 14.48 20 20" />
      <path d="M8.12 8.12 12 12" />
    </>
  ),
  paste: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>
  ),
  textStyle: (
    <>
      <path d="M4 7V5h16v2" />
      <path d="M9 19h6" />
      <path d="M12 5v14" />
    </>
  ),
  // ── Landing CTAs ─────────────────────────────────────────────────────────
  arrowRight: <path d="M4 12h16m0 0-6-6m6 6-6 6" />,
  arrowUpRight: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  play: <path d="M7 5.5v13l11-6.5Z" fill="currentColor" stroke="none" />,
};

export type IconName = keyof typeof GEOMETRY;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
  color = 'currentColor',
  className,
  style,
  title,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {GEOMETRY[name]}
    </svg>
  );
}
