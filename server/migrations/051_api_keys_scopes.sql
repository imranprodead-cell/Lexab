-- Публичный API, Фаза 3: зрелое управление ключами.
--
-- api_keys получают:
--   scopes        — права ключа (пустой массив = без ограничений, полный доступ;
--                   иначе whitelist: analyses:read/write, drafts:write,
--                   compares:write, templates:write, webhooks:manage).
--   expires_at    — срок действия (NULL = бессрочно); просроченный ключ
--                   findLiveKey уже не находит (гейт AND expires_at > now()).
--   created_by    — КТО из команды создал ключ (для командных ключей: владелец
--                   или админ; у личных = user_id).
--   team_owner_id — ВЛАДЕЛЕЦ команды, под чью квоту/лимит идут вызовы этого ключа
--                   (activeTeamOwnerFor ?? сам пользователь). user_id ключа = он же.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS team_owner_id TEXT;

-- Идемпотентность POST-заданий: повтор с тем же заголовком Idempotency-Key НЕ
-- создаёт второе задание и не списывает второй месячный юнит — возвращается id
-- ранее созданного. idem_hash = SHA-256(Idempotency-Key); kind защищает от
-- повторного использования одного ключа на РАЗНОМ эндпоинте (→ 409). Ключ идёт
-- по владельцу квоты (team_owner_id ключа = user_id вызова). Ретеншен — 7 дней
-- (идемпотентные повторы короткоживущие; та же daily-чистка, что api_requests).
CREATE TABLE IF NOT EXISTS api_idempotency (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idem_hash)
);
