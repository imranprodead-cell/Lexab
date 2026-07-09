-- Rich notifications (body + action buttons), team member job titles,
-- and cloud-storage integrations (Google Drive / Microsoft 365 / Dropbox).

ALTER TABLE notifications ADD COLUMN body TEXT;
ALTER TABLE notifications ADD COLUMN body_en TEXT;
-- 'team_invite' → action_data = invite token (bell shows an Accept button);
-- 'open' → action_data = internal app path (bell shows an Open button).
ALTER TABLE notifications ADD COLUMN action_kind TEXT;
ALTER TABLE notifications ADD COLUMN action_data TEXT;

-- Human job title shown in the UI (Юрист, Директор, …); access rights stay
-- in team_members.role (admin / editor / viewer).
ALTER TABLE team_members ADD COLUMN title_label TEXT;

CREATE TABLE integrations (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google-drive', 'microsoft', 'dropbox')),
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  account_email TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
