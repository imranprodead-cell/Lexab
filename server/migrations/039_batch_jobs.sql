-- Массовый разбор (Этап 3): пачка договоров одним заданием. Каждый файл уже
-- загружен через /uploads (хранилище/шифрование/извлечение текста переиспользуются);
-- задание прогоняет их через общий конвейер анализа по одному.

CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jurisdiction TEXT,
  -- queued → processing → done (done — когда обработаны все элементы, даже с ошибками)
  status TEXT NOT NULL DEFAULT 'queued',
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_user ON batch_jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  upload_id TEXT,
  document_id TEXT,
  analysis_id TEXT,
  risk_score INTEGER,
  risk_level TEXT,
  findings_count INTEGER,
  -- queued → processing → done | error
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items (batch_id, ord);
