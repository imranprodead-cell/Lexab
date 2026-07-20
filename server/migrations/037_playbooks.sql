-- Client playbooks: a team's standard contract positions ("no liability cap
-- above X", "arbitration only in Tashkent"). During analysis the AI flags any
-- clause that deviates from these positions as a finding.
--
-- Team-scoped, mirroring team_sso_config: keyed by owner_user_id (a "team" is
-- the owner user + their team_members). A playbook may target one jurisdiction
-- or apply to all (jurisdiction NULL). Rule text is sensitive → encrypted at
-- rest with the owner's data key (encText / decTextStrict), like saved_templates.
CREATE TABLE IF NOT EXISTS playbooks (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbooks_owner ON playbooks (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS playbook_rules (
  id          TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  text_enc    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_rules_pb ON playbook_rules (playbook_id, ord);

-- A finding that flags a deviation from the team's playbook (vs. a pure legal
-- risk finding) — lets the UI badge it distinctly.
ALTER TABLE findings ADD COLUMN IF NOT EXISTS playbook_deviation BOOLEAN NOT NULL DEFAULT false;
