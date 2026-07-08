-- LexAI schema. Shapes mirror src/types/domain.ts on the frontend.
-- IDs are app-generated TEXT (prefix + random) so seeded ids can match the
-- mock exactly ('c1', 'd1', 'an_employment_v3', …).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  initials      TEXT NOT NULL,
  firm          TEXT NOT NULL DEFAULT '',
  jurisdiction  TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

CREATE TABLE chat_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'text', 'analysis')),
  text        TEXT,
  file_name   TEXT,
  file_size   TEXT,
  analysis_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  counterparty TEXT NOT NULL DEFAULT '—',
  status       TEXT NOT NULL CHECK (status IN ('Draft', 'In review', 'Reviewed', 'Signed')),
  risk         TEXT NOT NULL CHECK (risk IN ('Low', 'Elevated', 'High')),
  jurisdiction TEXT NOT NULL DEFAULT 'UK',
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_user ON documents(user_id, updated_at DESC);

CREATE TABLE document_versions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  author      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_versions_doc ON document_versions(document_id, created_at DESC);

CREATE TABLE analyses (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id      TEXT REFERENCES documents(id) ON DELETE SET NULL,
  file_name        TEXT NOT NULL,
  file_size        TEXT NOT NULL,
  summary          TEXT NOT NULL,
  risk_score       INTEGER NOT NULL,
  risk_level       TEXT NOT NULL CHECK (risk_level IN ('Low', 'Elevated', 'High')),
  clauses_reviewed INTEGER NOT NULL,
  document_blocks  JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_analyses_user ON analyses(user_id, created_at DESC);

-- Finding/redline ids are scoped to their analysis (mock uses 'f1', 'r1', …).
CREATE TABLE findings (
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('High', 'Medium', 'Low')),
  title       TEXT NOT NULL,
  citation    TEXT NOT NULL,
  PRIMARY KEY (analysis_id, id)
);

CREATE TABLE redlines (
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  del_text    TEXT NOT NULL,
  ins_text    TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('High', 'Medium', 'Low')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  PRIMARY KEY (analysis_id, id)
);

-- Global template library (not per-user).
CREATE TABLE templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  clauses      INTEGER NOT NULL
);

CREATE TABLE signature_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('Draft', 'Sent', 'Viewed', 'Completed', 'Declined')),
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_signature_requests_user ON signature_requests(user_id, created_at DESC);

CREATE TABLE signature_recipients (
  request_id TEXT NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  signed     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (request_id, ord)
);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon       TEXT NOT NULL CHECK (icon IN ('esign', 'check', 'alert', 'docs')),
  title      TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE subscriptions (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan      TEXT NOT NULL DEFAULT 'Free',
  status    TEXT NOT NULL DEFAULT 'active',
  renews_at TIMESTAMPTZ
);

CREATE TABLE team_members (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  status        TEXT NOT NULL DEFAULT 'invited',
  color         TEXT NOT NULL DEFAULT 'var(--mut)',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_members_owner ON team_members(owner_user_id, created_at);

CREATE TABLE uploads (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  mime           TEXT,
  storage        TEXT NOT NULL CHECK (storage IN ('s3', 'local')),
  storage_key    TEXT NOT NULL,
  url            TEXT NOT NULL,
  extracted_text TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_uploads_user ON uploads(user_id, created_at DESC);

-- Analytics: one row per completed review + per-user tallies. The summary
-- endpoint aggregates these, so the numbers stay live as analyses run.
CREATE TABLE review_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  risk_score INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_events_user ON review_events(user_id, created_at);

CREATE TABLE user_stats (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  findings_high       INTEGER NOT NULL DEFAULT 0,
  findings_medium     INTEGER NOT NULL DEFAULT 0,
  findings_low        INTEGER NOT NULL DEFAULT 0,
  hours_saved_minutes INTEGER NOT NULL DEFAULT 0
);
