-- United States (US): seed the jurisdiction row. U.S. federal corpus is English,
-- so it uses the default English FTS branch already in migration 023's tsv CASE
-- (no tsv change needed). Core U.S. contract law (UCC Article 2) is state law and
-- is added later once an official machine-readable state source is available.
INSERT INTO jurisdictions (code, name, languages, citation_format) VALUES
  ('US', 'США', '{en}', '<Title> U.S.C. § <Section>, e.g. 9 U.S.C. § 2')
ON CONFLICT (code) DO NOTHING;
