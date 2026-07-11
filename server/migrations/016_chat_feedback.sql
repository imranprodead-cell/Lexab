-- Per-message user feedback on assistant replies (thumbs up / down).
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS feedback TEXT CHECK (feedback IN ('up', 'down'));
