-- Публичный API (тариф Business): ключи компаний + журнал API-вызовов.
--
-- api_keys: секрет НЕ хранится — только SHA-256 (ключ высокоэнтропийный,
-- показывается пользователю один раз при создании). key_prefix — первые
-- символы для узнаваемости в списке («lxb_a1b2c3d4…»). Отзыв = revoked_at.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id, created_at DESC);

-- api_requests: одновременно статус асинхронного задания (queued → processing →
-- done|error, паттерн batch_jobs) и журнал вызовов для графика Usage по дням.
-- analysis_id заполняется по завершении; текст договора здесь НЕ хранится.
CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  analysis_id TEXT,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'error')),
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_requests_user ON api_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_key ON api_requests (key_id, created_at DESC);

-- Месячный потолок API-запросов — тем же атомарным паттерном, что ai_requests
-- (инкремент-если-меньше-лимита одним UPDATE, без TOCTOU).
ALTER TABLE usage_counters ADD COLUMN IF NOT EXISTS api_requests INT NOT NULL DEFAULT 0;
