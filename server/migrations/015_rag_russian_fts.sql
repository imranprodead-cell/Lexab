-- Language-aware full-text search for the corpus: Russian chunks (UZ/KZ)
-- get the built-in Russian stemmer, English chunks keep the English one.
-- (The tsv generated column is rebuilt with a language CASE.)
ALTER TABLE chunks DROP COLUMN IF EXISTS tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
  to_tsvector(
    CASE WHEN language = 'ru' THEN 'russian'::regconfig ELSE 'english'::regconfig END,
    breadcrumb || ' ' || context_summary || ' ' || body
  )
) STORED;
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin(tsv);
