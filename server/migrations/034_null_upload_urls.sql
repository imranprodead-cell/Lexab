-- Провайдер-URL (Supabase signed / S3 public) указывают на зашифрованный
-- конверт LEXAIENC1: открывший такую ссылку получит «битый» файл. Наружу байты
-- отдаются только нашими эндпоинтами через readFileBytes (расшифровка).
-- Колонка становится nullable, старые сохранённые URL обнуляются; новые записи
-- пишут url = NULL.
ALTER TABLE uploads ALTER COLUMN url DROP NOT NULL;
UPDATE uploads SET url = NULL;
