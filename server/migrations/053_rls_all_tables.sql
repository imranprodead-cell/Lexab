-- Row Level Security на ВСЕХ таблицах схемы public + отзыв прав у публичных
-- ролей Supabase.
--
-- Зачем: миграция 004 включала RLS поимённо (18 таблиц), и каждая следующая
-- миграция про это забывала — к моменту аудита (2026-08-03) без RLS оказались
-- 30 таблиц из 54, включая api_keys, data_keys, audit_events, user_sessions,
-- analysis_shares, projects и user_totp. В живой базе RLS был включён руками,
-- то есть любое НОВОЕ окружение (staging, восстановление из дампа) поднялось бы
-- с открытым PostgREST-доступом по anon-ключу, который лежит во фронтенде.
--
-- Здесь два независимых контура защиты:
--   1) RLS без единой политики = deny-all для anon/authenticated (владелец
--      таблиц, под которым ходит наш сервер, RLS не подчиняется);
--   2) REVOKE прав у anon/authenticated — тогда защита не зависит от того,
--      вспомнил ли автор следующей миграции про ENABLE ROW LEVEL SECURITY.
-- Плюс ALTER DEFAULT PRIVILEGES: таблицы, созданные будущими миграциями,
-- сразу создаются без прав для публичных ролей.
--
-- Проверка «ни одной таблицы без RLS» живёт в scripts/verify-db.ts и в
-- test/rls.test.ts — чтобы дыра не вернулась в 31-й раз.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

-- Роли anon/authenticated существуют только в Supabase — на локальном Postgres
-- и PGlite блок просто пропускается.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;
