-- Пост-аудит незакоммиченного (2026-07-20): точечные усиления.

-- Анти-replay для TOTP: запоминаем номер последнего принятого 30-секундного
-- шага — тот же 6-значный код второй раз не принимается (RFC 6238 §5.2).
ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS last_used_step BIGINT;

-- Точная связь «событие ревью → анализ» для аналитики: старый джойн по
-- (created_at, risk_score) двоил находки при коллизии таймстампа+балла.
-- Для старых строк NULL — они просто не участвуют в графике находок.
ALTER TABLE review_events ADD COLUMN IF NOT EXISTS analysis_id TEXT;
