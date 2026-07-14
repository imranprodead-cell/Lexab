-- Link a finding to the redline that fixes it, so the UI can jump from a
-- finding card to the exact clause in the document. Nullable + no FK: many
-- findings have no matching redline, and redlines are deleted/rebuilt on
-- re-analysis (a stale link simply resolves to "not clickable").
ALTER TABLE findings ADD COLUMN redline_id TEXT;
