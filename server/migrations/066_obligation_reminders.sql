-- Сроки и напоминания, которые добавляет агент чата (решение владельца 2026-10-31):
-- обязательство с датой → письмо на почту пользователя за N дней.
--  - source: 'analysis' — извлечено разбором (перезаписывается при повторном
--    разборе, как раньше); 'chat' — добавлено пользователем по карточке агента
--    (повторный разбор его НЕ стирает);
--  - remind_days_before: за сколько дней напомнить (NULL — по умолчанию 7, как раньше);
--  - created_by: кто добавил — ему и уходит письмо (у командного документа это
--    может быть не владелец).
-- Номер 066: 064 занят веткой feature/team-workspace, 065 — счётчик «Улучшить».
ALTER TABLE contract_obligations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'analysis';
ALTER TABLE contract_obligations ADD COLUMN IF NOT EXISTS remind_days_before INTEGER;
ALTER TABLE contract_obligations ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
