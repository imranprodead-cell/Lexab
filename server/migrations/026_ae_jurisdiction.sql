-- UAE (AE): seed the jurisdiction row. Pilot corpus is the official English
-- translation of the UAE Civil Transactions Law (Federal Law No. 5 of 1985),
-- so it uses the default English FTS branch already in migration 023's tsv CASE
-- (no tsv change needed). Arabic original is out of scope (Postgres has no
-- built-in Arabic text-search config).
INSERT INTO jurisdictions (code, name, languages, citation_format) VALUES
  ('AE', 'ОАЭ', '{en,ar}', 'Article <N> Civil Transactions Law, e.g. Article 125')
ON CONFLICT (code) DO NOTHING;
