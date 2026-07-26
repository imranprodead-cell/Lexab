-- Публичные ссылки на отчёт анализа + исходящие вебхуки Slack/Teams.
--
-- analysis_shares: токен-ссылка «показать отчёт контрагенту» (паттерн как у
-- /sign/:token и /approve/:token). revoked_at вместо DELETE — владелец видит,
-- что ссылка отозвана, и может выдать новую.
CREATE TABLE IF NOT EXISTS analysis_shares (
  token       TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_analysis_shares_analysis ON analysis_shares(analysis_id);

-- user_webhooks: входящие вебхуки Slack/Teams, куда дублируются уведомления
-- колокольчика. URL содержит секрет — шифруется ключом пользователя (url_enc).
CREATE TABLE IF NOT EXISTS user_webhooks (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL CHECK (provider IN ('slack', 'teams')),
  url_enc    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
