-- Rolling context-window summary for chat sessions: the last ~10 messages go
-- to the model verbatim, everything older is folded into context_summary.
-- summary_covers = how many of the oldest turns the summary already includes.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS context_summary TEXT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary_covers INT NOT NULL DEFAULT 0;
