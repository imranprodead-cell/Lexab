-- УП/ПП Узбекистана: структурный номер акта («УП-6079»/«ПП-3724») для
-- детерминированного резолва цитат вида «п. 5 УП-6079» точным равенством,
-- а не title ILIKE. НЕ UNIQUE: нумерация указов исторически перезапускалась
-- (УП-184 от 2024 ≠ возможный старый УП-184). У законов остаётся NULL.
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS doc_number TEXT;

CREATE INDEX IF NOT EXISTS legal_documents_doc_number_idx
  ON legal_documents (jurisdiction, doc_number)
  WHERE doc_number IS NOT NULL;

-- Человеческая подсказка формата цитат (кодом не читается).
UPDATE jurisdictions
  SET citation_format = 'ст. <статья> <Кодекс/Закон>; п. <пункт> УП-<№>/ПП-<№>'
  WHERE code = 'UZ';
