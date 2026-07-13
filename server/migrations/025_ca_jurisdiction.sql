-- Canada (CA): seed the jurisdiction row. Pilot corpus is the Civil Code of
-- Québec (English consolidation), so it uses the default English FTS branch
-- already in migration 023's tsv CASE (no tsv change needed). Common-law
-- provinces' (judge-made) contract law is out of scope for the statute corpus.
INSERT INTO jurisdictions (code, name, languages, citation_format) VALUES
  ('CA', 'Канада', '{en,fr}', 'art. <Article> CCQ, e.g. art. 1385 CCQ')
ON CONFLICT (code) DO NOTHING;
