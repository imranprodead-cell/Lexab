-- Bind a signature request to the EXACT document version it was created for.
-- content_snapshot freezes the reviewed text at send time, so a signer always
-- sees and signs what they reviewed even if the owner later flips redlines
-- (bait-and-switch prevention). document_id ties completion to the one specific
-- document instead of every document that happens to share the same name.

ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS content_snapshot TEXT;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
