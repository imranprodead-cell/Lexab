-- Real e-signature provider (Dropbox Sign) linkage. Existing rows keep
-- provider NULL and continue to work as the in-app typed-name simulation.
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS signed_file_key TEXT;

CREATE INDEX IF NOT EXISTS idx_sig_requests_provider_id
  ON signature_requests (provider_request_id);

-- Map a provider signer back to our recipient row (Dropbox Sign signature_id).
ALTER TABLE signature_recipients ADD COLUMN IF NOT EXISTS provider_signature_id TEXT;
