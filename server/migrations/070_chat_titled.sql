-- Заголовок чата — один раз (решение владельца 2026-11-09): ИИ даёт короткий
-- заголовок по первому содержательному вопросу (lib/chatTitle.ts), потом чат
-- не переименовывается. titled_at ставится при этом заголовке и при ручном
-- переименовании; пока он пуст, сервер может дать чату заголовок.
-- Номер 070: 064 занят веткой feature/team-workspace.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS titled_at TIMESTAMPTZ;
-- Уже существующие чаты не трогаем: их заголовки остаются как есть.
UPDATE chat_sessions SET titled_at = updated_at WHERE titled_at IS NULL;
