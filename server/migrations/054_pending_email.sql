-- Смена почты аккаунта — через подтверждение, а не мгновенно.
--
-- Было (аудит 2026-08-03, находка №2): PATCH /me менял users.email СРАЗУ, без
-- пароля и без второго фактора. Украденная сессия превращалась в НЕОБРАТИМЫЙ
-- захват: письмо уходило только на НОВЫЙ адрес, ссылка из него выдавала
-- 30-дневную сессию в обход 2FA, а жертва после этого не могла ни войти
-- (её адреса в базе больше нет), ни восстановить пароль (сброс молча отвечал
-- 204). Показательно, что на куда менее опасных операциях step-up уже был:
-- /me/2fa/disable требует пароль, /auth/reset/confirm — код 2FA.
--
-- Стало: новый адрес живёт в pending_email до подтверждения по ссылке; сама
-- смена требует пароля (+ код 2FA, если включена), на СТАРЫЙ адрес уходит
-- предупреждение, а применение адреса поднимает token_version — все сессии,
-- включая сессию атакующего, обнуляются, и войти можно только зная пароль.

ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_expires TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_token_idx
  ON users (pending_email_token) WHERE pending_email_token IS NOT NULL;
