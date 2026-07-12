# LexAI (repo: Civis)

Legal AI SaaS: анализ договоров с привязкой к законодательству.
Юрисдикции: UK (живая), Узбекистан и Казахстан (заложены в схему, этап 2).

## Стек

- Фронтенд: React 18 + TypeScript + Vite (корень репозитория), порт 5173 (strictPort).
- Бэкенд: Fastify 5, Node 24 c нативным запуском TS (`server/`), порт 8080.
- База: Supabase Postgres + pgvector (миграции `server/migrations/*.sql`,
  применяются автоматически при старте сервера).
- ИИ: модель зависит от тарифа (`server/src/config.ts` → `planModels`).
  Платные планы — Anthropic API; Free — DeepSeek (OpenAI-совместимый клиент,
  включается ключом `DEEPSEEK_API_KEY`, id модели с «deepseek» маршрутизируется
  в него — `server/src/llm.ts`), при сбое ретрай на Anthropic. Эмбеддинги —
  Voyage AI `voyage-law-2` (RAG-поиск от генеративной модели не зависит).

## Запуск

```bash
cd server && npm run dev     # API на :8080 (авто-миграции)
npm run dev                  # фронтенд на :5173 (в корне)
```

Секреты — ТОЛЬКО в gitignored `.env` / `server/.env` (см. `server/.env.example`).

## Legal RAG — критические правила

1. **НИКОГДА не генерировать текст законов.** Тексты правовых норм попадают в
   корпус только из официальных источников. Если источник недоступен —
   документ помечается `status='missing'`; восстанавливать «по памяти»
   запрещено. Сгенерированный «текст закона» в юридическом продукте — worst
   case failure.
2. **Белый список источников:** legislation.gov.uk (UK законы),
   caselaw.nationalarchives.gov.uk (UK практика), lex.uz (UZ),
   adilet.zan.kz (KZ). Больше НИОТКУДА.
3. **Provenance обязателен** — enforced CHECK-констрейнтами (`source_url`,
   `sha256_checksum`, `retrieved_at`); строка без источника не вставится.
4. **Цитаты валидируются в коде, не в промпте** —
   `server/src/rag/validate-citations.ts`: находка без подтверждённой ссылки
   автоматически понижается и помечается `unverified: true`.
5. **Любое изменение ранжирования, промптов или индекса — обязательный прогон
   `npm run eval` до и после.** Отчёты в `server/evals/reports/`.

Схема корпуса и пайплайны: `docs/corpus-schema.md`. Статус: `HANDOFF.md`.

## Команды RAG (в `server/`)

```bash
npm run rag:ingest      # загрузка актов UK (идемпотентно; --force для перепарсинга)
npm run rag:ingest:uz   # загрузка законов РУз с lex.uz
npm run rag:index       # статьи → чанки + ИИ-контекст (--docs=… --max-annotate=N для бюджета)
npm run rag:embed       # векторы (нужен VOYAGE_API_KEY)
npm run eval            # метрики (--golden=uz-contract-law.jsonl для УЗ)
```

## Статус этапов RAG

- Этап 1 (схема, temporality, provenance) — ✅
- Этап 2 (ingestion UK, 8 пилотных актов) — ✅ (schedules и исторические
  редакции — позже)
- Этап 3 (чанки-статьи, гибридный retrieval, RRF, векторы voyage-law-2 на
  всём корпусе, cross-encoder reranker Voyage rerank-2.5-lite fail-open) — ✅
- Этап 4 (unit_id в находках + валидатор цитат, RU+EN форматы цитат,
  UI-бейдж «Проверено по базе законов» на находках) — ✅
- Этап 5 (eval-harness: golden UK 18 вопросов + golden UZ 14 вопросов) — ✅
- **Узбекистан — ✅ LIVE** (lex.uz: ГК ч.1+2, №670-I о договорно-правовой
  базе, ЗРУ-793 об ЭЦП, о защите прав потребителей; русская морфология FTS —
  миграция 015). Метрики UZ: точность цитат 2.5% без RAG → 100% с RAG;
  retrieval hit@5 100% (после дообогащения аннотаций).
- RAG подключён и к анализу (топ-10), и к чату (топ-5 по юрисдикции чата).
- Дальше по очереди: улучшения UK (schedules, case law) → новые страны:
  США → Германия → Канада → Казахстан → ОАЭ.

## Правила работы

- Всё проверять реальным запуском; не отчитываться о непроверенном.
- Моки — только в unit-тестах.
- Тесты: `npm test` в корне (vitest) и в `server/` (node:test).
- Тестовые пользователи в базе создаются только на время проверки и
  удаляются через DELETE /api/me.
