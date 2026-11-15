-- Тема находки и противоречия внутри договора (ui-test, решение владельца
-- 2026-11-15). topic ставит сам разбор (колонки «Таблицы проверок»);
-- conflict_a_enc / conflict_b_enc — две ДОСЛОВНЫЕ цитаты договора, которые
-- противоречат друг другу (код проверяет их наличие в тексте). Цитаты —
-- содержимое договора, поэтому зашифрованы ключом владельца, как правки.
-- Таблица findings уже под RLS (новых таблиц нет).
ALTER TABLE findings ADD COLUMN IF NOT EXISTS topic TEXT
  CHECK (topic IS NULL OR topic IN ('penalty', 'termination', 'disputes', 'payment', 'acceptance', 'other'));
ALTER TABLE findings ADD COLUMN IF NOT EXISTS conflict_a_enc TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS conflict_b_enc TEXT;
