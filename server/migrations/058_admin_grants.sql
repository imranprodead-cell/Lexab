-- Прямые продажи вместо платёжного провайдера (решение владельца 2026-08-06).
--
-- Lemon Squeezy отклонил верификацию магазина, поэтому платного самообслуживания
-- в продукте больше нет вовсе: тариф выдаёт ТОЛЬКО владелец из админ-панели.
-- Отсюда две вещи в схеме.
--
-- 1. subscriptions.source — откуда взялась подписка. Пока значение всегда
--    'manual', но колонка заведена сразу: когда появится платёжный провайдер,
--    развод ручных и провайдерских строк понадобится в первый же день
--    (иначе автопродление полезет «оживлять» подарочную подписку у провайдера,
--    не найдёт её и уронит клиента на Free — ровно этим уже болел LS-путь).
--    granted_by/grant_note — кто выдал и почему («оплатил переводом 06.08»);
--    без них через месяц не вспомнить, кому и за что открыт Business.
--
-- 2. user_limit_overrides — персональные лимиты поверх тарифа: конкретному
--    аккаунту можно дать больше или меньше, чем прописано в коде.
--
--    NULL в колонке = лимит НЕ переопределён, работает значение тарифа.
--    -1 = «без ограничения». Именно сентинел, а не NULL: иначе «без
--    ограничения» и «не задано» были бы неотличимы, и снять безлимит стало бы
--    невозможно. CHECK ниже не даёт записать другое отрицательное число.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS granted_by TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grant_note TEXT;

CREATE TABLE IF NOT EXISTS user_limit_overrides (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ai          INTEGER,
  docs        INTEGER,
  storage_mb  INTEGER,
  seats       INTEGER,
  api_monthly INTEGER,
  note        TEXT,
  set_by      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_limit_overrides_sentinel CHECK (
    (ai          IS NULL OR ai          >= -1) AND
    (docs        IS NULL OR docs        >= -1) AND
    (storage_mb  IS NULL OR storage_mb  >= -1) AND
    (seats       IS NULL OR seats       >= -1) AND
    (api_monthly IS NULL OR api_monthly >= -1)
  )
);

-- RLS в той же миграции, что и CREATE TABLE (правило проекта: 48 миграций
-- подряд про это забывали, и база открылась наружу).
ALTER TABLE user_limit_overrides ENABLE ROW LEVEL SECURITY;
