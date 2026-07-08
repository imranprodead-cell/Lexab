-- Chat sessions: user-managed state for the sidebar (pin / archive).
ALTER TABLE chat_sessions ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chat_sessions ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
