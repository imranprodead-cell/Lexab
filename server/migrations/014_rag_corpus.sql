-- Legal RAG corpus (Этап 1): jurisdictions, documents, hierarchical units,
-- court cases, retrieval chunks and ingestion journal.
--
-- CORE RULES enforced here, not in prompts:
--  * provenance is mandatory — a unit/chunk without source_url + checksum
--    cannot be inserted (CHECK constraints);
--  * temporality — every unit/chunk carries valid_from/valid_to, retrieval
--    filters by the redaction in force at the requested date.

-- pgvector: present on Supabase; absent in the PGlite dev fallback — the
-- schema must still apply there (embedding column/index added conditionally).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector unavailable — vector search disabled';
END $$;

CREATE TABLE IF NOT EXISTS jurisdictions (
  code            TEXT PRIMARY KEY,          -- 'UK' | 'UZ' | 'KZ'
  name            TEXT NOT NULL,
  languages       TEXT[] NOT NULL,           -- e.g. {'en'} / {'uz','ru'} / {'kk','ru'}
  citation_format TEXT NOT NULL              -- human hint, e.g. 'Sale of Goods Act 1979, s.14(2)'
);

INSERT INTO jurisdictions (code, name, languages, citation_format) VALUES
  ('UK', 'United Kingdom', '{en}',    '<Act Title> <Year>, s.<section>(<sub>)'),
  ('UZ', 'Узбекистан',     '{uz,ru}', 'ст. <статья> <Кодекс/Закон>'),
  ('KZ', 'Казахстан',      '{kk,ru}', 'ст. <статья> <Кодекс/Закон>')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS legal_documents (
  id                 TEXT PRIMARY KEY,                       -- ld_...
  jurisdiction       TEXT NOT NULL REFERENCES jurisdictions(code),
  official_source_id TEXT NOT NULL,                          -- e.g. 'ukpga/1979/54'
  doc_type           TEXT NOT NULL DEFAULT 'act',            -- act | code | regulation
  title              TEXT NOT NULL,
  title_translations JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'in_force',       -- in_force | repealed | missing
  source_url         TEXT NOT NULL CHECK (source_url <> ''),
  retrieved_at       TIMESTAMPTZ NOT NULL,
  sha256_checksum    TEXT NOT NULL CHECK (sha256_checksum <> ''),
  modified_on_source DATE,                                   -- dc:modified from the source
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction, official_source_id)
);

CREATE TABLE IF NOT EXISTS legal_units (
  id                TEXT PRIMARY KEY,                        -- deterministic: lu_<jur>_<doc>_<official unit id>
  document_id       TEXT NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  parent_id         TEXT REFERENCES legal_units(id) ON DELETE CASCADE,
  unit_type         TEXT NOT NULL,                           -- part|chapter|crossheading|section|subsection|article|paragraph
  number            TEXT,                                    -- '14', '2A', 'IV'
  heading           TEXT,
  breadcrumb        TEXT NOT NULL,                           -- 'UK / Sale of Goods Act 1979 / Part IV / s.14'
  text              TEXT NOT NULL DEFAULT '',
  language          TEXT NOT NULL DEFAULT 'en',
  ord               INT  NOT NULL DEFAULT 0,
  valid_from        DATE,
  valid_to          DATE,                                    -- NULL = current redaction
  official_unit_uri TEXT,                                    -- IdURI from the source
  source_url        TEXT NOT NULL CHECK (source_url <> ''),
  retrieved_at      TIMESTAMPTZ NOT NULL,
  sha256_checksum   TEXT NOT NULL CHECK (sha256_checksum <> '')
);
CREATE INDEX IF NOT EXISTS legal_units_document_idx ON legal_units(document_id);
CREATE INDEX IF NOT EXISTS legal_units_parent_idx   ON legal_units(parent_id);
CREATE INDEX IF NOT EXISTS legal_units_type_idx     ON legal_units(document_id, unit_type);

CREATE TABLE IF NOT EXISTS court_cases (
  id               TEXT PRIMARY KEY,                         -- cc_...
  jurisdiction     TEXT NOT NULL REFERENCES jurisdictions(code),
  neutral_citation TEXT,                                     -- e.g. [2017] UKSC 24
  court            TEXT,
  decision_date    DATE,
  title            TEXT NOT NULL,
  full_text        TEXT NOT NULL DEFAULT '',
  cited_unit_ids   TEXT[] NOT NULL DEFAULT '{}',
  source_url       TEXT NOT NULL CHECK (source_url <> ''),
  retrieved_at     TIMESTAMPTZ NOT NULL,
  sha256_checksum  TEXT NOT NULL CHECK (sha256_checksum <> ''),
  UNIQUE (jurisdiction, neutral_citation)
);

-- Retrieval unit: ONE whole section/article per chunk (never split mid-article).
-- Searchable text = breadcrumb + AI context summary + article body.
CREATE TABLE IF NOT EXISTS chunks (
  id              TEXT PRIMARY KEY,                          -- ch_<unit id>
  unit_id         TEXT NOT NULL UNIQUE REFERENCES legal_units(id) ON DELETE CASCADE,
  document_id     TEXT NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  jurisdiction    TEXT NOT NULL REFERENCES jurisdictions(code),
  language        TEXT NOT NULL DEFAULT 'en',
  source_type     TEXT NOT NULL DEFAULT 'legislation',       -- legislation | case_law
  breadcrumb      TEXT NOT NULL,
  context_summary TEXT NOT NULL DEFAULT '',                  -- 1-2 sentences, generated (Haiku)
  body            TEXT NOT NULL CHECK (body <> ''),
  tsv             tsvector GENERATED ALWAYS AS (
                    to_tsvector('english', breadcrumb || ' ' || context_summary || ' ' || body)
                  ) STORED,
  valid_from      DATE,
  valid_to        DATE,
  source_url      TEXT NOT NULL CHECK (source_url <> ''),
  retrieved_at    TIMESTAMPTZ NOT NULL,
  sha256_checksum TEXT NOT NULL CHECK (sha256_checksum <> '')
);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx  ON chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS chunks_meta_idx ON chunks(jurisdiction, language, source_type);

-- Dense-vector column + HNSW index only where pgvector is available
-- (embedding is nullable: rows are backfilled by `npm run rag:embed`).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id             TEXT PRIMARY KEY,                           -- ir_...
  source         TEXT NOT NULL,                              -- 'legislation.gov.uk'
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  docs_fetched   INT NOT NULL DEFAULT 0,
  docs_changed   INT NOT NULL DEFAULT 0,
  docs_unchanged INT NOT NULL DEFAULT 0,
  errors         INT NOT NULL DEFAULT 0,
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb          -- per-document diff/stats
);

-- Findings produced by the analysis pipeline can now carry a verified link
-- into the corpus (Этап 4: citation validation).
ALTER TABLE findings ADD COLUMN IF NOT EXISTS unit_id TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS unverified BOOLEAN NOT NULL DEFAULT false;
