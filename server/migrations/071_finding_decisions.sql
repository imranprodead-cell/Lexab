-- Решения по находкам разбора и отметки по продлению договора (ui-test,
-- решение владельца 2026-11-15). Раньше жили в браузере — теперь видны команде.
--
-- finding_decisions: «Исправлено / Не проблема / Передано коллеге» + кто и
-- когда. Комментарий — содержимое по договору, хранится зашифрованным ключом
-- ВЛАДЕЛЬЦА разбора (как правки и обязательства). Удаление разбора/находки
-- уносит решения (CASCADE).
CREATE TABLE IF NOT EXISTS finding_decisions (
  analysis_id TEXT NOT NULL,
  finding_id  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('fixed', 'ok', 'assigned')),
  decided_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_to TEXT,
  note_enc    TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (analysis_id, finding_id),
  FOREIGN KEY (analysis_id, finding_id) REFERENCES findings(analysis_id, id) ON DELETE CASCADE
);
ALTER TABLE finding_decisions ENABLE ROW LEVEL SECURITY;

-- renewal_marks: «Отказ отправлен» / «Продлеваем» по договору. last_day —
-- для какой даты отказа поставлена отметка: новый срок после переразбора
-- (другая дата) снова просит действия.
CREATE TABLE IF NOT EXISTS renewal_marks (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  last_day    DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('sent', 'keep')),
  marked_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE renewal_marks ENABLE ROW LEVEL SECURITY;
