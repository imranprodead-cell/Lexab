-- Правая колонка чата «Progress / Context» (2026-10-25).
--
-- chat_sessions.plan_progress — отметки выполненных шагов одобренного плана
-- (/plan → «Одобрить»): { "messageId": "m_…", "done": [0, 2] } — номера шагов
-- того ответа-плана. Юрист отмечает шаги сам; отметки видны с любого
-- устройства. NULL — отметок нет.
--
-- chat_messages.refs — статьи законов, найденные в базе для этого ответа
-- ИИ: [{ "label": "Статья 333", "doc": "Гражданский кодекс …" }]. Это
-- подписи из breadcrumb официального корпуса, не текст норм; вкладка
-- Sources показывает их и после перезагрузки. NULL — поиска не было.

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS plan_progress JSONB;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS refs JSONB;
