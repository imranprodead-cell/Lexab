-- CLM (Этап 2): метаданные жизненного цикла договора, извлекаемые анализом.
-- Даты хранятся ОТКРЫТО — по ним работают SQL-фильтры дедлайнов; сумма и текст
-- обязательств шифруются ключом владельца документа. Все поля извлечения
-- nullable: «модель не уверена → NULL», выдумывать значения запрещено.

CREATE TABLE IF NOT EXISTS contract_terms (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  effective_date DATE,
  expiry_date DATE,
  auto_renew BOOLEAN,
  renewal_notice_days INTEGER,
  contract_value_enc TEXT,
  currency TEXT,
  governing_law TEXT,
  -- Флаги-дедупликаторы напоминаний (как approval_steps.reminded): фоновая
  -- задача без leader-election обязана быть идемпотентной.
  expiry_reminded BOOLEAN NOT NULL DEFAULT false,
  renewal_reminded BOOLEAN NOT NULL DEFAULT false,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_terms_expiry
  ON contract_terms (expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS contract_obligations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text_enc TEXT NOT NULL,
  due_date DATE,
  responsible TEXT,
  reminded BOOLEAN NOT NULL DEFAULT false,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_obligations_doc
  ON contract_obligations (document_id, ord);
CREATE INDEX IF NOT EXISTS idx_contract_obligations_due
  ON contract_obligations (due_date) WHERE due_date IS NOT NULL AND NOT done;
