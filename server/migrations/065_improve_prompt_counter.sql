-- Месячный потолок кнопки «Улучшить промпт» (POST /prompts/improve) — решения
-- владельца 2026-10-30: Free 25, Standard 120, Pro 550, Business без потолка
-- (значения — IMPROVE_MONTHLY_LIMIT в lib/limits.ts). Раньше у кнопки был только
-- лимит 10/мин, а при сбое DeepSeek она уходила на Claude Haiku без месячного потолка.
-- Тот же атомарный паттерн, что ai_requests и api_requests (инкремент-если-
-- меньше-лимита одним UPDATE). Номер 065, а не 064: 064 занят веткой
-- feature/team-workspace (064_team_workspace.sql), ещё не влитой в main.
ALTER TABLE usage_counters ADD COLUMN IF NOT EXISTS improve_requests INT NOT NULL DEFAULT 0;
