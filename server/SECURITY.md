# LexAI — Security controls (SOC 2 / ISO 27001 audit map)

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
| Session revocation en masse (`token_version` bump on logout / password change / "sign out everywhere") | `src/plugins/auth.ts`, `src/routes/security.routes.ts` |
| Active-sessions visibility (device / IP / last-seen) | `user_sessions`, `GET /me/sessions` |
| RBAC for shared documents (owner / admin / editor / viewer) | `src/lib/teamAccess.ts` |
| SSO enforcement (org may require SSO; password login blocked, owner exempt) | `src/routes/sso.routes.ts` |
| Access review (who-has-access snapshot + CSV, member last-active) | `GET /team/access-review[.csv]`, `team_members.last_active_at` |

## Cryptography & data protection (CC6.1)

| Control | Where |
|---|---|
| Document content encrypted at rest (AES-256-GCM, per-user DEK wrapped by master KEK) | `src/lib/docCrypto.ts` |
| At-rest secrets sealing decoupled from JWT_SECRET (dedicated `SECRETS_ENCRYPTION_KEY`, legacy-key fallback) | `src/lib/secrets.ts`, `src/config.ts` |
| KEK rotation runbook (re-wrap per-user keys; current→previous file reads) | `scripts/rotate-kek.ts`, `.env.example` |
| Full 16-byte GCM tag enforced (rejects truncated-tag forgery, DEP0182) | `src/lib/docCrypto.ts`, `src/lib/secrets.ts` |
| TLS + security headers (HSTS, CSP, nosniff, frame lock) | `@fastify/helmet` in `src/app.ts` |
| Fail-closed secrets (server refuses to start on weak JWT/KEK unless explicitly opted out) | `src/config.ts` |
| Provider URLs never returned (byte-serving goes through authorising endpoints) | `src/routes/uploads.routes.ts` |

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
- **Session revocation.** The sessions list supports per-user "sign out
  everywhere" (token_version bump). Per-single-session revocation is not
  implemented — sessions are short-lived JWTs; scope this honestly in
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
