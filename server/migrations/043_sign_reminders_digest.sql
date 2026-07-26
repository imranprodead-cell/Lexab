-- Напоминания застрявшим подписантам + еженедельный дайджест на почту.
--
-- signature_recipients.reminded — дедуп-флаг «напоминание уже уходило»
-- (тот же приём, что approval_steps.reminded и contract_terms.*_reminded).
--
-- users.weekly_digest — выключатель понедельничной сводки (по умолчанию
-- включён; переключается в Настройках). users.digest_sent_at — когда сводка
-- уходила в последний раз: защита от повторной отправки в тот же понедельник
-- при перезапусках инстанса.
ALTER TABLE signature_recipients ADD COLUMN IF NOT EXISTS reminded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_digest BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_sent_at TIMESTAMPTZ;
