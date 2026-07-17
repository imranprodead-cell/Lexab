-- Per-user data-encryption keys (envelope scheme, see server/src/lib/docCrypto.ts).
-- key_wrapped holds the user's AES-256 data key wrapped by the master
-- DATA_ENCRYPTION_KEY ("k1:<kekId>:<iv>:<tag>:<ct>"). Deleting the row
-- (cascade on account deletion) crypto-shreds every encrypted value that
-- may linger in backups.
CREATE TABLE IF NOT EXISTS data_keys (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_wrapped TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
