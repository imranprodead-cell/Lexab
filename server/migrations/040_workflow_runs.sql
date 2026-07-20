-- Агентные воркфлоу (Этап 4): один запуск сценария по документу как цепочка
-- шагов. Каталог шагов фиксирован (analyze / apply-redlines / send-for-approval);
-- steps_json хранит выбранные шаги и их параметры, current_step — прогресс.

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  analysis_id TEXT,
  -- queued → running → done | failed
  status TEXT NOT NULL DEFAULT 'queued',
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_step INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_user ON workflow_runs (user_id, created_at DESC);
