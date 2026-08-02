# API contract

The frontend is backend-agnostic. Implement these endpoints and flip
`VITE_USE_MOCK_API=false`. All shapes are defined in
[`src/types/domain.ts`](./src/types/domain.ts) — the mock in `src/api/mock/`
mirrors them exactly, so treat that file as the schema.

Base URL comes from `VITE_API_BASE_URL` (e.g. `https://api.lexai.app`).
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
| GET    | `/v1/analyses/:id`  | —                                             | status + result (findings, riskScore, verified citations) |
| GET    | `/v1/analyses`      | `?limit&offset`                               | `{ items, limit, offset }`           |
| GET    | `/v1/usage`         | —                                             | `{ month, used, limit, remaining }`  |

Dashboard-side management (JWT session, 402 unless the plan includes
`apiAccess`): `GET/POST /api-keys`, `DELETE /api-keys/:id`,
`GET /api-keys/usage`.
