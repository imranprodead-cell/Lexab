-- Публичный API: обобщение api_requests на несколько видов заданий.
-- kind различает анализ / сравнение / черновик / шаблон; result хранит выход
-- тех видов, у которых нет строки-приёмника в analyses (compare/template) —
-- ЗАШИФРОВАННЫМ (envelope как document_blocks), т.к. может содержать текст
-- договора. analysis/draft по-прежнему ссылаются на analyses.analysis_id.
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'analysis';
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS result JSONB;
