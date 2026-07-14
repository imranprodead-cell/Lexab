-- Audit Log — append-only event trail (Business feature; read-gated by plan).
-- Reuses the append_only_guard() function created in migration 029.
CREATE TABLE audit_events (
  id            BIGSERIAL PRIMARY KEY,
  -- Tenant scope: the team owner's id (solo user = self; a teammate acting on a
  -- shared document logs under the DOCUMENT owner's id).
  team_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  -- Who did it — a plain id snapshot (NO foreign key). A teammate's actions
  -- must remain in the owner's log after the teammate deletes their account, and
  -- an ON DELETE SET NULL cascade would be an UPDATE the immutability guard
  -- vetoes. The denormalized actor_label survives renames/deletion.
  actor_id      TEXT,
  actor_label   TEXT,
  event_type    TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  target_label  TEXT,
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'denied')),
  ip            TEXT,
  user_agent    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Viewer query (per team, newest first) and brute-force counting (per ip/email).
CREATE INDEX audit_events_team_idx ON audit_events (team_owner_id, created_at DESC);
CREATE INDEX audit_events_type_ip_idx ON audit_events (event_type, ip, created_at);

-- Immutability guard: audit rows may never be UPDATEd (rewriting history is the
-- attack we defend against). DELETE stays allowed so (a) the retention sweep can
-- purge rows past the window and (b) deleting an account can CASCADE its trail
-- away (append_only_guard's retention block would wrongly veto that cascade).
CREATE OR REPLACE FUNCTION no_update_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: UPDATE is not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION no_update_guard();
