# Lexab — Security controls (SOC 2 / ISO 27001 audit map)

This document maps the **technical** controls implemented in code to the
criteria an auditor checks. The certificate itself is issued by an external
auditor over an observation window; this repo provides the controls they test.
Organisational controls (policies, IR plan, pentest, BCP, vendor management,
personnel security) are **not** code and are tracked separately.

## Identity & access (CC6)

| Control | Where |
|---|---|
| Password hashing (scrypt, per-user salt, constant-time compare) | `src/lib/passwords.ts` |
| Breached-password rejection (HIBP k-anonymity; only a SHA-1 prefix leaves the host; fail-open) | `src/lib/hibp.ts`, register/change/reset in `src/routes/auth.routes.ts` |
| Two-factor auth (TOTP, RFC 6238; ±1 step drift; sealed secret; single-use hashed backup codes) | `src/lib/totp.ts`, `src/routes/security.routes.ts`, login gate in `src/routes/auth.routes.ts` |
| Email verification before first session | `src/routes/auth.routes.ts` |
| Account-enumeration resistance (identical timing + response on register/login) | `src/routes/auth.routes.ts` (`dummyHash`, `LOGIN_FAILED`) |
| Brute-force detection + deduped alert (email + in-app + audit) | `src/routes/auth.routes.ts`, `src/lib/audit.ts` |
| Per-session revocation (`sid` in the JWT + a `user_sessions` row; logout ends only that device) **and** mass revocation (`token_version` bump on password change, email change and "sign out everywhere") | `src/plugins/auth.ts`, `src/routes/security.routes.ts` |
| Active-sessions visibility (device / IP / last-seen) | `user_sessions`, `GET /me/sessions` |
| RBAC for shared documents (owner / admin / editor / viewer) | `src/lib/teamAccess.ts` |
| SSO enforcement (org may require SSO; password login blocked, owner exempt) | `src/routes/sso.routes.ts` |
| Access review (who-has-access snapshot + CSV, member last-active) | `GET /team/access-review[.csv]`, `team_members.last_active_at` |

## Cryptography & data protection (CC6.1)

| Control | Where |
|---|---|
| Document content encrypted at rest (AES-256-GCM, per-user DEK wrapped by master KEK) | `src/lib/docCrypto.ts` |
| **What stays in clear text (be honest in questionnaires):** document/file names, counterparty, and finding titles + citations. They are indexed and sorted in SQL, which ciphertext cannot support. The contract text itself, the summary, the clause blocks and the redlines ARE encrypted. | `migrations/001_init.sql`, `src/routes/analysis.routes.ts` |
| At-rest secrets sealing decoupled from JWT_SECRET (dedicated `SECRETS_ENCRYPTION_KEY`, legacy-key fallback) | `src/lib/secrets.ts`, `src/config.ts` |
| KEK rotation runbook (re-wrap per-user keys; current→previous file reads) | `scripts/rotate-kek.ts`, `.env.example` |
| Full 16-byte GCM tag enforced (rejects truncated-tag forgery, DEP0182) | `src/lib/docCrypto.ts`, `src/lib/secrets.ts` |
| TLS + security headers (HSTS, CSP, nosniff, frame lock) | `@fastify/helmet` in `src/app.ts` |
| Fail-closed secrets (server refuses to start on weak JWT/KEK unless explicitly opted out) | `src/config.ts` |
| Provider URLs never returned (byte-serving goes through authorising endpoints) | `src/routes/uploads.routes.ts` |
| Row Level Security enabled on EVERY table + no grants for the public PostgREST roles (`anon`, `authenticated`) — the database is unreachable from the internet even with the anon key | `migrations/053_rls_all_tables.sql`, checked by `scripts/verify-db.ts` and `test/rls.test.ts` |

## Audit logging (CC7)

| Control | Where |
|---|---|
| Append-only audit log (immutability trigger; tenant-scoped) | `src/lib/audit.ts`, migrations |
| Events cover auth, documents, AI, redlines, files, approvals, workflows, 2FA, data export, retention purge | `AuditEventType` in `src/lib/audit.ts` |
| Audit export (JSON + CSV with OWASP CSV-injection defense) | `src/routes/audit.routes.ts` |
| Audit retention purge (configurable window, daily) | `checkAuditRetention` |

## Data lifecycle (CC6 / privacy)

| Control | Where |
|---|---|
| DSAR — portable export of ALL account data (JSON download) | `GET /me/export`, `src/routes/security.routes.ts` |
| Right to erasure (`DELETE /me` — cascade + stored-byte deletion) | `src/routes/auth.routes.ts` |
| Retention soft-delete + crypto-shred purge after the retention window | `documents.deleted_at`, `checkRetention` in `src/routes/documents.routes.ts` |

## Availability & resilience (CC7 / CC8)

| Control | Where |
|---|---|
| Per-request rate limiting + auth-specific caps | `@fastify/rate-limit` in `src/app.ts` |
| Atomic quota reservation (no TOCTOU on AI/doc/storage limits) | `src/lib/limits.ts` |
| Migration advisory lock (safe concurrent boots) | `src/db.ts` |
| Input validation on every route; file-signature verification on upload | `src/lib/validate.ts`, `src/extract.ts` |
| Best-effort side effects never block the primary write (notifications, storage cleanup) | throughout |

## Configuration reference

See `.env.example`. Compliance-relevant keys: `JWT_SECRET`,
`DATA_ENCRYPTION_KEY` (+ `_PREVIOUS`), `SECRETS_ENCRYPTION_KEY`,
`PASSWORD_BREACH_CHECK`, `DATA_RETENTION_DAYS`, `AUTH_BRUTEFORCE_ALERT_THRESHOLD`,
`SESSION_MAX_DAYS`.

## Scope notes (honest boundaries for the auditor)

- **Audit-event coverage.** 12 event types remain declared-but-reserved
  (`file.scan_*` now LIVE when CLAMD_HOST is set; `document.renamed/archived/
  moved_to_folder/version_restored`, `comment.*`, `user.blocked/unblocked`,
  `team.ownership_transferred` correspond to features that do not exist yet —
  they will start emitting the day those features ship, никаких пробелов в
  trail для существующих действий нет).
- **Session revocation.** Two mechanisms exist and both are real: logging out
  ends exactly that session (the JWT carries a `sid` matched against a
  `user_sessions` row), and password change / email change / "sign out
  everywhere" bump `token_version`, which invalidates every issued token at
  once. The honest gap: there is no UI button to terminate ONE OTHER listed
  session — `GET /me/sessions` only shows them. Scope it that way in
  questionnaires.
- **Malware scanning.** ClamAV hook (uploads + inbound mail) активируется
  переменной CLAMD_HOST; без него остаётся magic-byte валидация. Заражённые
  файлы отклоняются (422) с аудит-событием `file.scan_failed`.

## Out of scope for code (organisational — track separately)

Security policies & staff training, incident-response plan, third-party
penetration test, business-continuity / disaster-recovery plan, vendor risk
management, background checks, change-management approvals, physical security of
the hosting provider (covered by the provider's own SOC 2 — AWS / Supabase).

**Трекер организационной части: `SECURITY-ORG-CHECKLIST.md` (чеклист основателя).**
