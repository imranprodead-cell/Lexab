# Lexab Backend

Production backend for the Lexab frontend in the repository root. Implements
every endpoint in [`../BACKEND_HANDOFF.md`](../BACKEND_HANDOFF.md) with the
exact request/response shapes defined by
[`../src/types/domain.ts`](../src/types/domain.ts).

**Stack:** Node 23.6+ (native TypeScript, no build step) · Fastify 5 ·
Postgres (`pg`, with an embedded [PGlite](https://pglite.dev) fallback for
zero-setup local dev) · JWT auth · S3 uploads (local-disk fallback) ·
Anthropic Claude for contract analysis and chat.

---

## Quick start — run frontend + backend together

```bash
# 1. Backend
cd server
npm install
cp .env.example .env          # defaults work out of the box (embedded DB, demo auth)
npm run dev                   # applies migrations, listens on :8080

# 2. Frontend (repo root, separate terminal)
cd ..
npm install
printf 'VITE_USE_MOCK_API=false\nVITE_API_BASE_URL=http://localhost:8080/api\n' > .env
npm run dev                   # http://localhost:5173
```

Authentication is strict everywhere — there is no demo mode. Register a real
account via the UI (or `POST /api/auth/register`); `src/api/client.ts` sends
`Authorization: Bearer <token>` from the persisted session.

- **Demo data is opt-in and dev-only.** `npm run seed` refuses to run unless
  BOTH `SEED_DEMO_DATA=true` and a non-empty `SEED_DEMO_PASSWORD` are set —
  it creates an account on the Pro plan, so it must never run in production.

Without an `ANTHROPIC_API_KEY`, `/analysis` and chat replies use
deterministic fallbacks so the app still works end-to-end. Set the key to get
real Claude-generated analyses and chat.

## Real Postgres (recommended for production)

```bash
cd server
docker compose up -d db
echo 'DATABASE_URL=postgres://lexai:lexai@localhost:5432/lexai' >> .env
npm run migrate               # NO seeding: demo data is dev-only (see below)
npm start
```

When `DATABASE_URL` is empty, the server uses PGlite — actual Postgres
compiled to WASM, persisted to `DATA_DIR/pg` — running the same migrations
and SQL. Great for dev; use managed Postgres in production.

## Configuration

All settings are environment variables — see [`.env.example`](./.env.example).
The important ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (empty → embedded PGlite) |
| `JWT_SECRET` | Token signing secret — **must** be set in production |
| `AUTH_MODE` | `demo` (unauthenticated → demo user) or `required` |
| `ANTHROPIC_API_KEY` | Enables real LLM analysis + chat (`claude-opus-4-8`) |
| `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT` | S3 uploads (empty bucket → local disk under `DATA_DIR/uploads`) |
| `CORS_ORIGIN` | Allowed frontend origins (comma-separated) |
| `API_PREFIX` | Route prefix, default `/api` |

## Endpoints

Everything below is served under `API_PREFIX` (default `/api`) and returns
errors as non-2xx with `{ "message": string }`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/register`, `POST /auth/logout`, `POST /auth/reset` (rate-limited 10/min) |
| User | `GET /me`, `PATCH /me` (incl. `avatarUrl`) |
| Chats | `GET /chats`, `POST /chats`, `GET /chats/:id/messages`, `POST /chats/:id/messages` |
| Analysis | `POST /analysis` (rate-limited 10/min), `GET /analysis/:id`, `PATCH /analysis/:id/redlines/:rid` |
| Uploads | `POST /uploads` (multipart, PDF/DOC/DOCX/TXT ≤ 10 MB), `GET /files/:key` |
| Documents | `GET /documents` (`search`, `status`, `risk`, `sort`, `page`, `pageSize`; total in `X-Total-Count`), `GET /documents/:id`, `GET /documents/:id/versions`, `POST /documents/:id/export` (`docx`/`pdf` binary) |
| Templates | `GET /templates?category=` |
| Signatures | `GET /signatures`, `POST /signatures` |
| Analytics | `GET /analytics/summary` |
| Notifications | `GET /notifications`, `POST /notifications/read` |
| Billing | `GET /billing/subscription`, `POST /billing/checkout` |
| Team | `GET /team/members`, `POST /team/invite` |
| Meta | `GET /health` |

### Streaming

Both long-running endpoints support SSE when the client sends
`Accept: text/event-stream` (and plain JSON otherwise — which is what the
current frontend uses, so no UI change is needed):

- `POST /analysis` → `step` events (`{index, label}` for parse → law-check →
  report), then one `result` event with the full `AnalysisResult`.
- `POST /chats/:id/messages` → `token` events (`{text}` deltas), then a
  `done` event with the persisted assistant `ChatMessage`.

```bash
curl -N -H 'Accept: text/event-stream' -H 'Content-Type: application/json' \
  -d '{"fileName":"NDA.docx","fileSize":"22 KB"}' \
  http://localhost:8080/api/analysis
```

### How `/analysis` gets the contract content

The frontend posts `{ fileName, fileSize }` after uploading the file via
`POST /uploads`. The server matches the newest upload with that file name for
the authenticated user and feeds its content to Claude — `.txt`/`.docx` as
extracted text, `.pdf` natively as a document block. `POST /analysis` also
accepts a direct multipart `file`. If no content is available, Claude reviews
from the file name alone (and without an API key a deterministic demo-style
analysis is returned). Each analysis also upserts the matching row on the
Documents page, appends a version entry, updates the analytics counters, and
creates a notification.

## Data model

See [`migrations/001_init.sql`](./migrations/001_init.sql): `users`,
`chat_sessions`, `chat_messages`, `documents`, `document_versions`,
`analyses`, `findings`, `redlines`, `templates`, `signature_requests`,
`signature_recipients`, `notifications`, `subscriptions`, `team_members`,
`uploads`, `review_events`, `user_stats`. Migrations are plain SQL applied in
filename order and tracked in `schema_migrations` (`npm run migrate`).

`npm run seed` (dev-only: requires `SEED_DEMO_DATA=true` + `SEED_DEMO_PASSWORD`) loads the
same demo content as the frontend mock: the demo user, 7 chat sessions, the
canonical `an_employment_v3` analysis with its 3 redlines, 7 documents with
version history, 6 templates, 2 signature requests, 3 notifications, the team
roster, and analytics that reproduce the mock's numbers (148 reviews, avg
risk 41, 27 high-risk findings, 216 hours saved).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with file-watching (auto-migrate + auto-seed) |
| `npm start` | Start once |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Seed demo data if the DB is empty |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | End-to-end curl test against a running server |

## Production notes

- Set `JWT_SECRET`, `AUTH_MODE=required`, `DATABASE_URL`, `S3_BUCKET`, and
  `CORS_ORIGIN` to your real frontend origin.
- Logout invalidates all of a user's outstanding tokens (per-user
  `token_version` bump); passwords are scrypt-hashed.
- `POST /billing/checkout` returns a placeholder hosted-checkout URL — swap in
  your PSP (e.g. Stripe Checkout session) there.
- `POST /auth/reset` always returns 204; wire an email provider to deliver the
  reset link.
- Rate limits: 300/min global, 10/min on `/auth/*` and `/analysis`, 20/min on
  `/uploads`. Virus-scanning uploads (e.g. ClamAV) is recommended before
  production exposure.

## Reverse proxy & audit-log IPs

Behind nginx/Cloudflare set `TRUST_PROXY=true` (or the number of trusted hops)
in `.env` — otherwise `request.ip`, and therefore the IP column of the audit
log, records the proxy's address instead of the client's. Deploy artefacts must
also include `server/assets/fonts` (NotoSans): without it the PDF report falls
back to Helvetica, which cannot encode Cyrillic.
