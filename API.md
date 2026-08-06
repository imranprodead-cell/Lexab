# API contract

The frontend is backend-agnostic. Implement these endpoints and flip
`VITE_USE_MOCK_API=false`. All shapes are defined in
[`src/types/domain.ts`](./src/types/domain.ts) — the mock in `src/api/mock/`
mirrors them exactly, so treat that file as the schema.

Base URL comes from `VITE_API_BASE_URL` (e.g. `https://api.lexabai.com`).
All bodies and responses are JSON. Errors should return a non-2xx status with
`{ "message": string }`; the client surfaces `message` to the user.

---

## Endpoints

### Analysis

| Method | Path              | Body                                | Returns          |
| ------ | ----------------- | ----------------------------------- | ---------------- |
| POST   | `/analysis`       | `{ fileName: string; fileSize: string }` | `AnalysisResult` |
| GET    | `/analysis/:id`   | —                                   | `AnalysisResult` |

`POST /analysis` kicks off a contract review. The mock resolves after ~3.4s to
mimic parsing → statute check → report. A real implementation may stream
progress via SSE/WebSocket; the UI animates the three visible steps
independently, so streaming is optional for a first cut — returning the final
`AnalysisResult` is enough.

`AnalysisResult` includes `summary`, `riskScore` (0–100), `riskLevel`,
`clausesReviewed`, `findings[]`, `redlines[]`, and the `document[]` block list
(mixed headings + paragraphs, where paragraphs contain inline redline slots).

### Chats

| Method | Path      | Body                | Returns         |
| ------ | --------- | ------------------- | --------------- |
| GET    | `/chats`  | —                   | `ChatSession[]` |
| POST   | `/chats`  | `{ title: string }` | `ChatSession`   |

Sessions are grouped client-side into Today / Yesterday / Previous 7 days by
`updatedAt`.

### Documents

| Method | Path                       | Query                         | Returns              |
| ------ | -------------------------- | ----------------------------- | -------------------- |
| GET    | `/documents`               | `search`, `status`, `risk`    | `ContractDocument[]` |
| GET    | `/documents/:id/versions`  | —                             | `DocumentVersion[]`  |

### Templates

| Method | Path         | Query      | Returns      |
| ------ | ------------ | ---------- | ------------ |
| GET    | `/templates` | `category` | `Template[]` |

### Signatures

| Method | Path          | Body                                                          | Returns             |
| ------ | ------------- | ------------------------------------------------------------ | ------------------- |
| GET    | `/signatures` | —                                                            | `SignatureRequest[]` |
| POST   | `/signatures` | `{ documentName: string; recipients: {name;email}[] }`        | `SignatureRequest`  |

### Analytics

| Method | Path                 | Returns            |
| ------ | -------------------- | ------------------ |
| GET    | `/analytics/summary` | `AnalyticsSummary` |

### User

| Method | Path  | Body                      | Returns       |
| ------ | ----- | ------------------------- | ------------- |
| GET    | `/me` | —                         | `UserProfile` |
| PATCH  | `/me` | `Partial<UserProfile>`    | `UserProfile` |

---

## Auth

Sign-in / sign-up are currently mocked in `src/store/useAuthStore.ts` (any
well-formed credentials succeed; a fake token is persisted to localStorage).

To make it real, implement:

| Method | Path             | Body                                  | Returns                          |
| ------ | ---------------- | ------------------------------------- | -------------------------------- |
| POST   | `/auth/login`    | `{ email, password }`                 | `{ token: string; user: UserProfile }` |
| POST   | `/auth/register` | `{ name, email, password }`           | `{ token: string; user: UserProfile }` |
| POST   | `/auth/logout`   | —                                     | `204`                            |

Then swap `mockAuth` for these calls and add the token to `client.ts` `http()`
via the `headers` option (`Authorization: Bearer <token>`). The route guard
(`RequireAuth`) and all screens stay unchanged.

Additional endpoints the new frontend is wired for (mocked today): document
detail `GET /documents/:id`, notifications `GET /notifications`, and a billing
checkout for the Plans page.

---



## Public API (Business plan) — `/api/v1/*`

Machine-to-machine API for Business customers, authenticated by API key
(`Authorization: Bearer lxb_…` or `X-API-Key`), managed in the dashboard's
**API** section (`/developer`). Errors use `{ "error": { "code", "message" } }`.
Limits: `API_MONTHLY_LIMIT` (default 1000) analyses/month per account, and a
60 requests/min burst limit (bucketed per source IP; requires `TRUST_PROXY`
behind a reverse proxy so `req.ip` is the real client).

| Method | Path                | Body                                          | Returns                              |
| ------ | ------------------- | --------------------------------------------- | ------------------------------------ |
| POST   | `/v1/analyses`      | `{ text, fileName?, jurisdiction? }` or multipart `file` | `202 { id, status: 'processing' }` |
| GET    | `/v1/analyses/:id`  | `?report=1` → adds `reportUrl` (public `/share` page) | status + result (findings, riskScore, verified citations) |
| GET    | `/v1/analyses`      | `?limit&offset`                               | `{ items, limit, offset }`           |
| POST   | `/v1/drafts`        | `{ prompt, jurisdiction? }`                   | `202 { id, status: 'processing' }`   |
| GET    | `/v1/drafts/:id`    | `?report=1` → adds `reportUrl`                | status + `{ title, summary, document }` |
| POST   | `/v1/compares`      | `{ textA, textB, nameA?, nameB? }` or multipart `fileA`+`fileB` | `202 { id, status }`  |
| GET    | `/v1/compares/:id`  | —                                             | status + `{ summary, changes }`      |
| GET    | `/v1/templates`     | —                                             | `{ items }` (catalog, no AI)         |
| POST   | `/v1/templates/:id/generate` | `{ partyA, partyB, details, jurisdiction?, term? }` | `202 { id, status }` |
| GET    | `/v1/templates/requests/:id` | —                                    | status + `{ title, content }`        |
| POST   | `/v1/webhooks`      | `{ url, events? }`                            | `201 { id, events, signingSecret }` (secret shown once) |
| GET    | `/v1/webhooks`      | —                                             | `{ items }` (urls masked)            |
| DELETE | `/v1/webhooks/:id`  | —                                             | `204`                                |
| GET    | `/v1/usage`         | —                                             | `{ month, used, limit, remaining }`  |

**Webhooks** (callback on job completion): payload is minimal
(`{ event, id, kind, status[, error] }` — no contract text), signed with
`X-Lexab-Signature` = HMAC-SHA256(rawBody, signingSecret). https-only, SSRF-guarded
(public IPs only), retries with backoff (1m/5m/30m/2h/6h, 5 attempts).

**Idempotency**: pass an `Idempotency-Key` header (≤256 chars) on any `POST /v1/*`
job endpoint — a retry with the same key returns the previously created job and
does not consume a second monthly unit. Reusing a key on a *different* endpoint
returns `409 idempotency_key_reused`.

**Key scopes** (Phase 3): a key may be restricted to a subset of
`analyses:read`, `analyses:write`, `drafts:write`, `compares:write`,
`templates:write`, `webhooks:manage`; empty scope list = unrestricted. A request
outside the key's scopes returns `403 insufficient_scope`. Write scopes imply
polling their own kind. Keys may carry an expiry (`expiresInDays` at creation);
an expired key behaves as `401 invalid_api_key`.

**Rate-limit headers**: `x-ratelimit-limit/remaining/reset` and `retry-after`
are exposed via CORS for browser SDKs.

Dashboard-side management (JWT session, 402 unless the plan includes
`apiAccess`): `GET/POST /api-keys` (create accepts `scopes`, `expiresInDays`),
`GET /api-keys/scopes` (catalog), `POST /api-keys/:id/rotate` (revoke + reissue
with same label/scopes, new secret shown once), `DELETE /api-keys/:id`,
`GET /api-keys/usage`. Team accounts: keys belong to the team owner (owner's
quota); the owner and active **admins** manage them (`created_by` shown in the
list), editors/viewers get 403.
