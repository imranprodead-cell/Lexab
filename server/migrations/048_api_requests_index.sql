-- Публичный API: частичный индекс под recovery-свип осиротевших заданий
-- (failInterruptedApiRequests сканирует только queued/processing по updated_at).
-- Терминальные строки в индекс не входят, поэтому он остаётся крошечным даже
-- при большом журнале, а свип — O(число_в_работе), не O(вся_таблица).
CREATE INDEX IF NOT EXISTS idx_api_requests_inflight
  ON api_requests (updated_at) WHERE status IN ('queued', 'processing');
