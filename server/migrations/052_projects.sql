-- Проекты (дела юристов): папка, внутри которой живут договоры клиента/дела.
-- Доступно ВСЕМ тарифам (включая Free) — базовая организация работы.
--
-- Удаление проекта НЕ удаляет документы: FK ON DELETE SET NULL возвращает их
-- в общий список (потеря дела не должна уничтожать договоры).
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id, updated_at DESC);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents (project_id) WHERE project_id IS NOT NULL;
