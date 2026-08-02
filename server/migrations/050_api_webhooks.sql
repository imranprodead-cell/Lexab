-- Публичный API: callback-вебхуки — уведомляем систему клиента, когда задание
-- (analysis/draft/compare/template) завершилось, вместо ручного поллинга.
--
-- api_webhook_endpoints: куда слать. url_enc и signing_secret_enc ЗАШИФРОВАНЫ
-- ключом владельца (envelope как user_webhooks.url_enc). events — фильтр видов
-- событий ('*' = все). Один эндпоинт на аккаунт достаточно, но допускаем
-- несколько (напр. dev/prod).
CREATE TABLE IF NOT EXISTS api_webhook_endpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  url_enc TEXT NOT NULL,
  signing_secret_enc TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{*}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_webhook_endpoints_user ON api_webhook_endpoints (user_id) WHERE revoked_at IS NULL;

-- api_webhook_deliveries: журнал доставок + очередь ретраев. payload — МИНИМАЛЬНЫЙ
-- (event/id/kind/status[/error]) БЕЗ текста договора и находок. status queued →
-- delivered|failed; ретраи по next_attempt_at с бэкоффом.
CREATE TABLE IF NOT EXISTS api_webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES api_webhook_endpoints(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_request_id TEXT,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  response_code INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Частичный индекс под свип: только не-финальные строки, готовые к попытке.
CREATE INDEX IF NOT EXISTS idx_api_webhook_deliveries_due
  ON api_webhook_deliveries (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_api_webhook_deliveries_user ON api_webhook_deliveries (user_id, created_at DESC);
