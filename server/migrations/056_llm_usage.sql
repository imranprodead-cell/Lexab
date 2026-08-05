-- Журнал расхода токенов ИИ (см. src/lib/aiUsage.ts).
--
-- До аудита 2026-08-03 расход не сохранялся нигде: строка в stdout — и всё.
-- Ни ответа на «кто сжёг деньги в этом месяце», ни динамики, ни возможности
-- заметить аномалию — при том что модели это главная статья расходов продукта.
--
-- ON DELETE SET NULL, а не CASCADE: удаление аккаунта не должно стирать факт
-- понесённых расходов (в строке нет ничего персонального — только операция,
-- модель и числа), но и связи с человеком после удаления остаться не должно.

CREATE TABLE IF NOT EXISTS llm_usage (
  id                BIGSERIAL PRIMARY KEY,
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  op                TEXT NOT NULL,
  model             TEXT NOT NULL,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_month ON llm_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage (created_at DESC);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
