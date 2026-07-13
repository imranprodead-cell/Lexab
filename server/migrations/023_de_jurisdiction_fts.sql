-- Germany (DE): seed the jurisdiction row and extend the corpus FTS with the
-- built-in German stemmer. Mirrors retrieve.ts FTS_CONFIG (DE → 'german').

INSERT INTO jurisdictions (code, name, languages, citation_format) VALUES
  ('DE', 'Германия', '{de}', '§ <Paragraph> <Gesetz>, z. B. § 433 BGB')
ON CONFLICT (code) DO NOTHING;

-- Rebuild the generated tsv column: German chunks get the German stemmer,
-- Russian chunks (UZ/KZ) the Russian one, everything else English.
ALTER TABLE chunks DROP COLUMN IF EXISTS tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
  to_tsvector(
    CASE
      WHEN language = 'ru' THEN 'russian'::regconfig
      WHEN language = 'de' THEN 'german'::regconfig
      ELSE 'english'::regconfig
    END,
    breadcrumb || ' ' || context_summary || ' ' || body
  )
) STORED;
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin(tsv);
