-- Карта связей между нормами (этап 1 «графа», решение владельца 2026-11-08).
-- Связи строит КОД из официального текста (src/rag/links.ts, npm run rag:links):
--   refers     — статья ссылается на статью («статьи 416 настоящего Кодекса»);
--   interprets — пункт Пленума называет статью, которую разъясняет;
--   cocited    — две статьи названы в одном пункте Пленума (ГК + спецзакон).
-- Никакой генерации: у каждой связи цитата-основание (quote) из текста нормы-
-- источника и provenance этой нормы (source_url, sha256, retrieved_at) — как у
-- всего корпуса (CHECK-констрейнты). Цель обязана существовать (FK) — связь на
-- несуществующую статью не вставится. Пересборка: DELETE + INSERT по юрисдикции.
-- Номер 068: 064 занят веткой feature/team-workspace.
CREATE TABLE IF NOT EXISTS legal_links (
  from_unit_id    TEXT NOT NULL REFERENCES legal_units(id) ON DELETE CASCADE,
  to_unit_id      TEXT NOT NULL REFERENCES legal_units(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('refers', 'interprets', 'cocited')),
  jurisdiction    TEXT NOT NULL REFERENCES jurisdictions(code),
  quote           TEXT NOT NULL CHECK (quote <> ''),
  -- для cocited — пункт Пленума, в котором обе статьи названы вместе
  via_unit_id     TEXT REFERENCES legal_units(id) ON DELETE CASCADE,
  source_url      TEXT NOT NULL CHECK (source_url <> ''),
  sha256_checksum TEXT NOT NULL CHECK (sha256_checksum <> ''),
  retrieved_at    TIMESTAMPTZ NOT NULL,
  built_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_unit_id, to_unit_id, kind),
  CHECK (from_unit_id <> to_unit_id)
);
CREATE INDEX IF NOT EXISTS legal_links_to_idx ON legal_links (to_unit_id);
CREATE INDEX IF NOT EXISTS legal_links_jur_idx ON legal_links (jurisdiction);

ALTER TABLE legal_links ENABLE ROW LEVEL SECURITY;
