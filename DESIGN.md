# Design tokens

All values are exposed as CSS custom properties in
[`src/styles/global.css`](./src/styles/global.css). The accent is overridable at
runtime (Settings → Appearance) via `--accent` on `<html>`.

## Colour

| Token          | Value                     | Use                              |
| -------------- | ------------------------- | -------------------------------- |
| `--bg`         | `#101014`                 | App background                   |
| `--panel`      | `#17171C`                 | Panels, cards, rail              |
| `--panel-2`    | `#1C1C22`                 | Raised surfaces, inputs          |
| `--doc-bg`     | `#0D0D11`                 | Document viewer backdrop         |
| `--border`     | `#26262E`                 | Hairline borders                 |
| `--text`       | `#E7E7EC`                 | Primary text                     |
| `--dim`        | `#9A9AA6`                 | Secondary text                   |
| `--mut`        | `#5F5F6A`                 | Muted / metadata                 |
| `--accent`     | `#8B7CF6` (violet)        | Accent — brand, primary actions  |
| `--on-accent`  | `#0C0C10`                 | Text/icons on accent             |
| `--sev-high`   | `oklch(0.68 0.17 22)`     | High severity / danger (red)     |
| `--sev-med`    | `oklch(0.79 0.14 78)`     | Medium / elevated (amber)        |
| `--sev-low`    | `oklch(0.74 0.13 150)`    | Low / success (green)            |

Accent alpha tints use `color-mix(in srgb, var(--accent) N%, transparent)`.
Alternative accents offered in Settings: `#5b8def`, `#3fb8af`, `#e0666b`.

## Typography

- **Sans:** Instrument Sans (400/500/600/700) — UI text.
- **Label:** Manrope (400/500/600/700), `--font-label` — citations, badges,
  metadata, uppercase section eyebrows. Full Cyrillic. (Replaced JetBrains
  Mono in 2026-07; the CSS variable was renamed `--font-mono` → `--font-label`.)
- **Serif:** Georgia — the contract document body only.

Notable sizes: welcome H1 34px/700; page title 22px/700; body 15px; card title
14.5px/600; badge 10.5px label-face uppercase; risk gauge number 34px/700.

## Radii

`--r-sm 6 · --r-md 9 · --r-lg 12 · --r-xl 16` (px).

## Elevation

- `--shadow-card`: `0 1px 0 rgba(255,255,255,.05) inset, 0 24px 60px -30px rgba(0,0,0,.7)`
- `--shadow-pop`: `0 20px 60px -20px rgba(0,0,0,.6)`

Glass surfaces: `background: rgba(28,28,36,.55)` + `backdrop-filter: blur(20px) saturate(1.3)`.

## Motion

Durations `--dur-fast .15s · --dur-mid .22s · --dur-slow .5s`, easing
`cubic-bezier(.4,0,.2,1)`. Keyframes: `lxspin, lxfade, lxfadeq, lxblink,
lxpulse, lxglow` (+ `lxshimmer` for skeletons). All motion collapses to ~0s when
`html[data-reduce-motion="true"]` is set (Settings → Reduce motion).

## Rail dimensions

Collapsed 64px, expanded 272px, width transition on hover (or pinned).
Workspace split: left 40% (min 380px) / right 60%; stacks vertically below 900px.
