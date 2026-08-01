-- Lemon Squeezy: привязка подписок к провайдеру + журнал вебхуков.
--
-- subscriptions.ls_*: идентификаторы LS (customer/subscription/variant) и
-- ls_event_updated_at — монотонный guard: вебхук с attributes.updated_at не
-- новее сохранённого считается устаревшим/переставленным и пропускается.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ls_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ls_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ls_variant_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ls_event_updated_at TIMESTAMPTZ;

-- Один LS-subscription не может принадлежать двум пользователям.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_ls_subscription
  ON subscriptions (ls_subscription_id) WHERE ls_subscription_id IS NOT NULL;

-- Операционный журнал входящих вебхуков (НЕ юридическое доказательство —
-- этим остаётся append-only billing_events). Идемпотентность: у Lemon Squeezy
-- нет уникального id события (meta.webhook_id — id КОНФИГУРАЦИИ вебхука),
-- поэтому дедуп — по SHA-256 сырого тела: ретраи LS шлют байт-в-байт то же
-- тело, INSERT ... ON CONFLICT DO NOTHING отсекает повтор.
CREATE TABLE IF NOT EXISTS ls_webhook_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  body_sha256 TEXT NOT NULL UNIQUE,
  ls_subscription_id TEXT,
  user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processed', 'skipped', 'error')),
  error TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ls_webhook_events_created
  ON ls_webhook_events (created_at DESC);
