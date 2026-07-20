-- SOC2/ISO audit-readiness (Этап 5): 2FA, active-sessions visibility,
-- retention soft-delete, access-review timestamps.

-- Two-factor auth (TOTP). One row per user; secret is sealed (lib/secrets.ts),
-- backup codes stored as SHA-256 hashes (JSON array). enabled=false while a
-- setup is pending confirmation.
CREATE TABLE IF NOT EXISTS user_totp (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_sealed TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recorded sessions for the "active sessions" view. Not an auth gate (tokens
-- stay stateless, revoked en masse via users.token_version) — a visibility +
-- access-review control. Written on login, last_seen bumped on refresh.
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id, last_seen_at DESC);

-- Retention soft-delete: a document hidden from the app, crypto-shredded (row +
-- file bytes destroyed) by the purge sweep after config.dataRetentionDays.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- Access review: when each team member last acted (for the "who has access" report).
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
