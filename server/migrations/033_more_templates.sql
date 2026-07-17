-- Expand the contract-template catalog from 6 to 26 and add Russian labels.
-- Generation is generic (server/src/llm.ts TEMPLATE_SYSTEM), so a new template is
-- pure data — no code path changes. Seed only runs on a fresh DB, so an existing
-- production DB gets these rows only via this migration.

ALTER TABLE templates ADD COLUMN IF NOT EXISTS name_ru        TEXT;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS description_ru TEXT;

-- Russian labels for the original six (English name/description stay for the
-- LLM prompt; the UI shows *_ru for ru/kk/uz users).
UPDATE templates SET name_ru = 'Двусторонний NDA',            description_ru = 'Взаимное соглашение о неразглашении для ранних переговоров.'                  WHERE id = 't1';
UPDATE templates SET name_ru = 'Трудовой договор',            description_ru = 'Бессрочный трудовой договор с сотрудником (право Великобритании).'            WHERE id = 't2';
UPDATE templates SET name_ru = 'Рамочный договор услуг (MSA)', description_ru = 'Рамочное соглашение о регулярных профессиональных услугах.'                   WHERE id = 't3';
UPDATE templates SET name_ru = 'Соглашение об обработке данных', description_ru = 'Условия обработчика по статье 28 GDPR.'                                        WHERE id = 't4';
UPDATE templates SET name_ru = 'SAFE (Post-Money)',           description_ru = 'Простое соглашение о будущем участии в капитале.'                             WHERE id = 't5';
UPDATE templates SET name_ru = 'Договор консультационных услуг', description_ru = 'Условия привлечения независимого консультанта.'                              WHERE id = 't6';

-- 20 new templates (t7–t26). ON CONFLICT keeps this idempotent and safe on any
-- DB that somehow already has an id. CIS staples are anchored to UZ/KZ (the
-- jurisdictions the product actually supports), never a free-text "Россия".
INSERT INTO templates (id, name, name_ru, category, description, description_ru, jurisdiction, clauses) VALUES
  ('t7',  'Residential Lease',            'Аренда квартиры',                    'Real Estate', 'Residential tenancy between individuals.',                     'Найм жилого помещения между физлицами: срок, депозит, коммунальные платежи.',      'UZ', 14),
  ('t8',  'Commercial Lease',             'Аренда коммерческого помещения',     'Real Estate', 'Office or retail space lease.',                                'Аренда офиса или торговой площади: индексация, ремонт, досрочное расторжение.',    'KZ', 20),
  ('t9',  'Services Agreement',           'Договор оказания услуг',             'Commercial',  'Paid provision of services.',                                 'Возмездное оказание услуг: объём, сроки, приёмка, оплата.',                        'UZ', 15),
  ('t10', 'Work Contract',                'Договор подряда',                    'Commercial',  'Contract for work with a deliverable.',                       'Выполнение работ с результатом: этапы, приёмка, гарантия, неустойка.',             'UZ', 18),
  ('t11', 'Sale of Goods',                'Договор купли-продажи товара',       'Sales',       'One-off sale of goods.',                                      'Разовая купля-продажа: качество, передача, переход риска.',                        'KZ', 12),
  ('t12', 'Supply Agreement',             'Договор поставки',                   'Sales',       'Recurring deliveries of goods.',                              'Регулярные поставки: график, приёмка по количеству/качеству, ответственность.',    'KZ', 17),
  ('t13', 'Personal Loan',                'Договор займа между физлицами',      'Finance',     'Loan of money between individuals.',                          'Денежный займ: сумма, проценты, график возврата, расписка.',                       'UZ', 10),
  ('t14', 'Employment Contract (UZ)',     'Трудовой договор (Узбекистан)',      'Employment',  'Employment contract under the Labour Code of Uzbekistan.',    'Трудовой договор по ТК Республики Узбекистан: испытательный срок, отпуск.',        'UZ', 22),
  ('t15', 'Employment Contract (KZ)',     'Трудовой договор (Казахстан)',       'Employment',  'Employment contract under the Labour Code of Kazakhstan.',    'Трудовой договор по ТК Республики Казахстан.',                                     'KZ', 22),
  ('t16', 'Contractor Agreement',         'Договор с самозанятым / ИП',         'Employment',  'Civil-law engagement of a contractor (no employment).',       'Гражданско-правовой договор с самозанятым или ИП: без трудовых отношений.',        'KZ', 13),
  ('t17', 'Agency Agreement',             'Агентский договор',                  'Commercial',  'Agent acts on behalf of a principal.',                        'Агент действует от имени принципала: полномочия, вознаграждение, отчёты.',         'GB', 16),
  ('t18', 'License Agreement',            'Лицензионный договор',               'IP & IT',     'License of software or content.',                             'Лицензия на ПО или контент: объём прав, территория, роялти.',                      'US', 15),
  ('t19', 'Mandate Agreement',            'Договор поручения',                  'Commercial',  'Attorney performs legal acts for a principal.',               'Поверенный совершает юридические действия от имени доверителя.',                   'UZ', 11),
  ('t20', 'Distribution Agreement',       'Дистрибьюторский договор',           'Commercial',  'Exclusive or non-exclusive distribution.',                    'Эксклюзивная/неэксклюзивная дистрибуция: территория, планы продаж.',               'AE', 19),
  ('t21', 'Franchise Agreement',          'Договор франчайзинга',               'Commercial',  'Commercial concession: brand, standards, royalties.',         'Коммерческая концессия: бренд, стандарты, паушальный взнос, роялти.',              'AE', 24),
  ('t22', 'Service Level Agreement (SLA)','Соглашение об уровне сервиса (SLA)', 'IP & IT',     'Availability metrics, response times, service credits.',      'Метрики доступности, время реакции, сервисные кредиты.',                           'GB', 12),
  ('t23', 'Business Loan',                'Кредитный договор для бизнеса',      'Finance',     'Loan to a company: tranches, covenants, security.',           'Займ для компании: транши, ковенанты, обеспечение, досрочное погашение.',          'GB', 16),
  ('t24', 'Shareholders'' Agreement',     'Акционерное соглашение',             'Corporate',   'Shareholder rights: governance, drag/tag-along.',             'Права акционеров: управление, drag/tag-along, преимущественная покупка.',          'GB', 28),
  ('t25', 'Software Development Agreement','Договор на разработку ПО',           'IP & IT',     'Bespoke development: spec, milestones, IP, acceptance.',       'Заказная разработка: ТЗ, этапы, IP-права, приёмка, поддержка.',                    'US', 21),
  ('t26', 'Freelance Contract',           'Международный фриланс-контракт',      'Commercial',  'Cross-border contract with a freelancer.',                    'Кросс-граничный контракт с фрилансером: оплата, IP, независимый статус.',          'US', 12)
ON CONFLICT (id) DO NOTHING;
