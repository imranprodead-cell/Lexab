-- «Активные сессии» показывали одно устройство десятком строк (2026-10-17).
--
-- Каждый вход писал новую строку user_sessions, а повторный вход с того же
-- браузера (после «сессия истекла», очистки данных, входа через Google) старую
-- не трогал. device_id — постоянный случайный номер браузера (localStorage на
-- клиенте): вход с тем же номером заменяет прошлую сессию этого браузера.
-- Строки до этой миграции остаются с NULL и в списке склеиваются по браузеру.
-- Новых таблиц нет — RLS не затрагивается.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS user_sessions_user_device_idx ON user_sessions (user_id, device_id);
