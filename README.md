# LexAI — Contract Intelligence (Frontend)

Production-ready frontend for **LexAI**, an AI contract-intelligence platform: a
chat-first workspace where a lawyer uploads a contract, watches the AI stream
its analysis, and reviews tracked-change redlines side-by-side with the
document.

Built with **React 18 + TypeScript + Vite**. State is managed with **Zustand**,
routing with **React Router**, and all backend calls go through a swappable
**API layer** that currently returns mock data.

---

## Quick start

```bash
npm install
cp .env.example .env      # optional — mock API is on by default
npm run dev               # http://localhost:5173
```

Other scripts:

```bash
npm run build       # type-check (tsc -b) + production build
npm run preview     # serve the production build
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

> Requires Node 18+.

---

## Connecting a real backend

The UI never calls `fetch` directly — it calls the API modules in `src/api/`.
Each module checks one flag and either returns mock data or hits the real
endpoint:

```ts
// src/api/client.ts
export const USE_MOCK = (import.meta.env.VITE_USE_MOCK_API ?? 'true') === 'true';
```

To go live:

1. Implement the endpoints listed in [`API.md`](./API.md).
2. Set `VITE_USE_MOCK_API=false` and `VITE_API_BASE_URL=https://…` in `.env`.

No component changes are required — the request/response shapes are fixed by
`src/types/domain.ts`, which both the mock and the real backend must satisfy.

---

## Project structure

```
src/
├─ api/                REST layer. One module per resource; mock + real behind USE_MOCK.
│  ├─ client.ts        fetch wrapper + USE_MOCK flag
│  ├─ util.ts          delay/clone/ApiError helpers
│  ├─ mock/db.ts       in-memory mock database (seeded from data/seed.ts)
│  ├─ analysis.api.ts  POST /analysis, GET /analysis/:id
│  ├─ documents.api.ts documents.api, templates, signatures, analytics, chats, user…
│  └─ index.ts         barrel export — import from '@/api'
├─ components/
│  ├─ icons/           Icon component (inline SVG set)
│  ├─ ui/              reusable primitives: Button, Badge, GlassCard, Modal,
│  │                   TextField, CitationChip, Avatar, Spinner, States, ToastHost
│  ├─ layout/          AppShell, SideRail (hover-expand), TopBar
│  ├─ chat/            WelcomeScreen, ChatInput + SlashMenu, AnalysisCard,
│  │                   SummaryCard, RiskGauge, UserFileBubble
│  └─ workspace/       DocumentViewer, RedlineSpan, FloatingToolbar,
│                      SendForSignatureModal, VersionHistoryModal
├─ pages/              route screens: Chat, Workspace, Documents, Templates,
│                      Signatures, Analytics, Settings, NotFound
├─ store/              Zustand stores: useUIStore, useChatStore
├─ hooks/              useAsync, useStreamingText, useKeyboardShortcuts, useMediaQuery
├─ data/seed.ts        seed data for the mock API
├─ types/domain.ts     the single source of truth for all data shapes
├─ router/routes.tsx   route table
└─ styles/global.css   design tokens (CSS variables), resets, keyframes
```

Styling: **CSS custom properties** for the theme (so the accent colour is
re-themeable at runtime) plus **feature-scoped CSS Modules**
(`*.module.css`). No CSS framework.

---

## Routes

| Path                             | Screen                                              |
| -------------------------------- | --------------------------------------------------- |
| `/login`                         | Sign in / sign up (mock auth)                       |
| `/chat`, `/chat/:sessionId`      | Conversational canvas + streaming analysis          |
| `/chat/:sessionId/workspace`     | Split review workspace (redlines) — also `/workspace` |
| `/documents`                     | Contracts table (search + status/risk filters)      |
| `/documents/:id`                 | Contract detail (metadata, versions, actions)       |
| `/templates`                     | Template library (category filter)                  |
| `/signatures`                    | E-signature request tracker                         |
| `/analytics`                     | Portfolio dashboard                                 |
| `/team`                          | Team / members (roles, invite) — mock               |
| `/compare`                       | Side-by-side version diff (`/compare` command)      |
| `/plans`                         | Pricing / subscription plans                        |
| `/settings`                      | Profile, avatar, theme (light/dark/system), language |

All `/` routes are gated by `RequireAuth`; unauthenticated users are sent to `/login`.

---

## Key interactions

- **Auth** — email/password sign-in & sign-up (mock, persisted). Route guard +
  logout from the sidebar.
- **i18n RU/EN** — full interface dictionary (`src/i18n`), switchable in Settings;
  choice persists. Default is Russian (English for `en-*` browsers).
- **Light / dark theme** — top-bar moon/sun toggle + Settings; persists. Only
  surface/text tokens change — violet brand accent stays. Default: light.
- **Drag-and-drop upload** — drop a PDF/DOCX/TXT onto the chat to start analysis
  (validated); a chat session is recorded in history.
- **Streaming chat** — `/analyze` runs the animated analysis; `/draft`,
  `/compare`, `/translate` and plain messages stream a mock assistant reply.
- **Voice input** — mic button dictates into the composer (Web Speech API).
- **Command palette** — ⌘K / Ctrl+K to search, navigate, and run quick actions.
- **Notifications** — bell + dropdown feed (mock) with unread badge.
- **Jurisdiction selector** — searchable country picker with round flags.
- **Plans** — Free · Standard · Pro · Business · Enterprise; current plan marked.
- **Export** — Download DOCX (Word-openable) / print-to-PDF of the reviewed doc,
  client-side (`src/lib/exportDocument.ts`).
- **Onboarding** — first-run 3-step tour (shows once).
- **Network resilience** — GET retries with backoff, offline/online toasts.
- **Hover-expand side rail** — icon-only at rest, expands to a full sidebar with
  recent chats grouped by date. Pin it open in Settings (or press `\`); on mobile,
  a hamburger toggles it.
- **Keyboard shortcuts** — `g` then `c/d/t/e/a/s` to navigate; `\` toggles the rail.

Loading, empty, and error states are implemented on every data-backed screen;
forms (auth, settings, send-for-signature) validate before submit.

Run `npm test` for the Vitest unit suite (formatters, i18n dictionary, data).

---

## Design reference

The original interactive HTML prototype lives at the repository root of the
design project as `LexAI.dc.html`. This React app reproduces it faithfully; the
prototype remains the visual source of truth. See [`DESIGN.md`](./DESIGN.md) for
the exact tokens.
