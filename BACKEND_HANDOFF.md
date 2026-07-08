# LexAI — Backend Handoff

This frontend is **complete and backend-agnostic**. Every network call goes
through `src/api/*`, which today returns mock data. Your job (backend) is to
implement the endpoints below so the UI works against a real server — **without
changing any UI code**.

Open this repo in VS Code / Claude Code and use the prompt at the bottom.

---

## 1. How the frontend talks to the backend

- All HTTP goes through `src/api/client.ts` → `http<T>(path, options)`.
- The switch is one env flag:

  ```bash
  # .env
  VITE_USE_MOCK_API=false
  VITE_API_BASE_URL=https://api.yourhost.com
  ```

  When `false`, every `*.api.ts` module calls the real endpoint instead of the mock.
- Request/response **shapes are fixed** by `src/types/domain.ts`. Treat that file
  as the schema — the mock in `src/api/mock/db.ts` mirrors it exactly.
- Errors: return non-2xx with JSON `{ "message": string }`. The client shows
  `message` to the user and retries idempotent GETs (2×, backoff).
- Auth: send `Authorization: Bearer <token>`; add it in `client.ts` `http()`
  headers once login returns a token (one line, noted in code).

---

## 2. Endpoints to implement

Base URL = `VITE_API_BASE_URL`. All JSON. Types in `src/types/domain.ts`.

### Auth  → `src/store/useAuthStore.ts`
| Method | Path             | Body                        | Returns |
| ------ | ---------------- | --------------------------- | ------- |
| POST   | `/auth/login`    | `{ email, password }`       | `{ token, user: UserProfile }` |
| POST   | `/auth/register` | `{ name, email, password }` | `{ token, user: UserProfile }` |
| POST   | `/auth/logout`   | —                           | `204` |
| POST   | `/auth/reset`    | `{ email }`                 | `204` (sends reset email) |

### User  → `src/api/analytics.api.ts` (userApi)
| GET   | `/me`            | — | `UserProfile` |
| PATCH | `/me`            | `Partial<UserProfile>` (incl. `avatarUrl`) | `UserProfile` |

### Chats / sessions  → `src/api/chats.api.ts`, `src/store/useChatHistoryStore.ts`
| GET   | `/chats`         | — | `ChatSession[]` |
| POST  | `/chats`         | `{ title }` | `ChatSession` |
| GET   | `/chats/:id/messages` | — | `ChatMessage[]` |
| POST  | `/chats/:id/messages` | `{ text }` | streamed assistant reply (see §3) |

### Analysis  → `src/api/analysis.api.ts`
| POST  | `/analysis`      | `{ fileName, fileSize }` (or multipart file) | `AnalysisResult` |
| GET   | `/analysis/:id`  | — | `AnalysisResult` |
| PATCH | `/analysis/:id/redlines/:rid` | `{ status: 'accepted'|'rejected' }` | `Redline` |

`AnalysisResult` = summary, riskScore 0–100, riskLevel, clausesReviewed,
findings[], redlines[], document[] (headings + paragraphs w/ inline redline slots).

### File upload  → chat drag-and-drop
| POST  | `/uploads`       | multipart `file` | `{ fileName, fileSize, url }` then feed into `/analysis` |

### Documents  → `src/api/documents.api.ts`
| GET   | `/documents`     | query `search,status,risk,sort,page` | `ContractDocument[]` (+ total for pagination) |
| GET   | `/documents/:id` | — | `ContractDocument` |
| GET   | `/documents/:id/versions` | — | `DocumentVersion[]` |

### Templates  → `src/api/templates.api.ts`
| GET   | `/templates`     | query `category` | `Template[]` |

### Signatures  → `src/api/signatures.api.ts`
| GET   | `/signatures`    | — | `SignatureRequest[]` |
| POST  | `/signatures`    | `{ documentName, recipients:[{name,email}] }` | `SignatureRequest` |

### Analytics  → `src/api/analytics.api.ts`
| GET   | `/analytics/summary` | — | `AnalyticsSummary` |

### Notifications  → `src/store/useNotificationsStore.ts`
| GET   | `/notifications` | — | `AppNotification[]` |
| POST  | `/notifications/read` | `{ id? }` (omit = all) | `204` |

### Export  → `src/lib/exportDocument.ts`
| POST  | `/documents/:id/export` | `{ format: 'docx'|'pdf' }` | binary file (optional — client can also build DOCX locally) |

### Billing (Plans page)
| GET   | `/billing/subscription` | — | `{ plan, status, renewsAt }` |
| POST  | `/billing/checkout` | `{ plan }` | `{ checkoutUrl }` |

### Team  → `src/pages/TeamPage.tsx`
| GET   | `/team/members`  | — | `Member[]` |
| POST  | `/team/invite`   | `{ email, role }` | `Member` |

---

## 3. Streaming (analysis steps + chat replies)

The UI animates progress and streams text on its own, so a simple JSON response
is enough for v1. For a production feel, stream via **SSE** or **WebSocket**:
- `/analysis` → emit `step` events (parse / law-check / report), then a final
  `result` event with `AnalysisResult`.
- `/chats/:id/messages` → emit `token` events; the client already renders a
  streaming cursor.

If you keep plain JSON, no UI change is needed — the client falls back to its
own timed animation.

---

## 4. Non-functional requirements

- **CORS**: allow the frontend origin; expose `Authorization`.
- **Auth**: JWT (access + refresh) or session cookie. Token persisted client-side today.
- **Validation**: reject malformed bodies with `400 { message }`.
- **File limits**: PDF/DOC/DOCX/TXT, ≤ ~10 MB; virus-scan recommended.
- **Rate limiting** on `/analysis` and `/auth/*`.
- **Persistence**: users, chat sessions + messages, documents + versions,
  analyses + redline states, signature requests, notifications, subscriptions.

Suggested stack (your call): Node + Fastify/Nest + Postgres (Prisma), or
Python + FastAPI + SQLAlchemy. Object storage (S3) for uploads. An LLM provider
for `/analysis` and chat.

---

## 5. Acceptance checklist

- [ ] `VITE_USE_MOCK_API=false` + real `VITE_API_BASE_URL` → app runs, login works.
- [ ] Upload a contract → `/analysis` returns a valid `AnalysisResult`; workspace shows redlines.
- [ ] Accept/Reject redline persists via PATCH.
- [ ] Documents list paginates, filters, sorts server-side.
- [ ] Signature request POST creates a tracked request.
- [ ] Notifications + analytics load from server.
- [ ] All responses match `src/types/domain.ts` (no UI changes required).

---

## Prompt to paste into Claude Code

> This repo is a finished React + TypeScript + Vite **frontend** for “LexAI”, an
> AI contract-intelligence app. It talks to the backend only through
> `src/api/*`, gated by `VITE_USE_MOCK_API`. Read `BACKEND_HANDOFF.md`,
> `API.md`, and `src/types/domain.ts`, then build a production backend that
> implements every endpoint with those exact request/response shapes. Use
> [Node+Fastify+Postgres / your choice], JWT auth, S3 uploads, and an LLM for
> `/analysis` and chat. Do not modify the frontend except adding the bearer
> token in `src/api/client.ts`. Deliver: schema/migrations, endpoint handlers,
> auth, file upload, streaming for `/analysis`, seed data matching the mock, a
> `.env.example`, and a README to run both together.
