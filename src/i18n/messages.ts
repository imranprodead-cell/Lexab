/**
 * Lightweight i18n dictionary. Keys are dot-namespaced by feature. The
 * LanguageProvider resolves a key + optional interpolation params to a string.
 *
 * Adding a language = add a column to each entry. No runtime deps.
 */

export type Language = 'en' | 'ru' | 'ar' | 'de' | 'kk' | 'uz';

/** Order matters: EN and RU stay first; the rest are the product's markets. */
export const LANGUAGES: { code: Language; label: string; short: string; dir?: 'rtl' }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'ar', label: 'العربية', short: 'AR', dir: 'rtl' },
  { code: 'de', label: 'Deutsch', short: 'DE' },
  { code: 'kk', label: 'Қазақша', short: 'KK' },
  { code: 'uz', label: 'Oʻzbekcha', short: 'UZ' },
];

const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/** Narrow an arbitrary string to a supported Language. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGE_CODES as string[]).includes(value);
}

/** True for right-to-left languages (Arabic) — drives the document `dir`. */
export function isRtl(lang: Language): boolean {
  return LANGUAGES.find((l) => l.code === lang)?.dir === 'rtl';
}

type Dict = Record<string, { ru: string; en: string }>;

/**
 * Pick the right string from an inline bilingual `{ ru, en }` literal (page
 * copy, plan descriptions, …). Only RU has its own text; every other language
 * falls back to English.
 */
export function pickText(
  entry: { ru: string; en: string } & Partial<Record<Language, string>>,
  lang: Language,
): string {
  // Точный язык, если у записи есть перевод (лендинг переведён на все 6);
  // иначе — прежний фолбэк: русский для ru, английский для остальных.
  return entry[lang] ?? (lang === 'ru' ? entry.ru : entry.en);
}

/**
 * Реестр словарей доп. языков. Заполняется лениво (loadDict.ts): uz/ar/kk/de
 * не входят в главный чанк (−240KB) и приезжают отдельными файлами по нужде.
 */
const EXTRA_DICTS: Partial<Record<Language, Record<string, string>>> = {};

/** Кладёт загруженный словарь в реестр (идемпотентно). */
export function registerExtraLanguage(lang: Language, dict: Record<string, string>): void {
  EXTRA_DICTS[lang] = dict;
}

/** true, если язык можно рендерить синхронно: ru/en или словарь уже загружен. */
export function hasExtraLanguage(lang: Language): boolean {
  return lang === 'ru' || lang === 'en' || EXTRA_DICTS[lang] !== undefined;
}

/**
 * Resolve a key for any language. RU/EN come from the base MESSAGES; the extra
 * languages come from their lazily-loaded dictionaries, falling back to
 * English (then the raw key) when a string hasn't been translated yet.
 */
export function resolveMessage(key: string, lang: Language): string | undefined {
  const entry = MESSAGES[key];
  if (!entry) return undefined;
  if (lang === 'ru' || lang === 'en') return entry[lang];
  return EXTRA_DICTS[lang]?.[key] ?? entry.en;
}

export const MESSAGES: Dict = {
  // Navigation
  'nav.chat': { ru: 'Чат', en: 'Chat' },
  'nav.documents': { ru: 'Документы', en: 'Documents' },
  'nav.templates': { ru: 'Шаблоны', en: 'Templates' },
  'nav.playbooks': { ru: 'Плейбуки', en: 'Playbooks' },
  'nav.contracts': { ru: 'Контракты', en: 'Contracts' },
  'nav.batch': { ru: 'Массовый разбор', en: 'Batch review' },
  'nav.signatures': { ru: 'Э-подписи', en: 'E-signatures' },
  'nav.analytics': { ru: 'Аналитика', en: 'Analytics' },
  'nav.settings': { ru: 'Настройки', en: 'Settings' },
  'nav.team': { ru: 'Команда', en: 'Team' },
  'nav.api': { ru: 'API', en: 'API' },
  'nav.newReview': { ru: 'Новый обзор', en: 'New review' },
  'nav.newChat': { ru: 'Новый чат', en: 'New chat' },
  'brand.proDesc': { ru: 'Лучшие модели и больше возможностей', en: 'The best models and more' },
  'brand.baseDesc': { ru: 'Отлично подходит для повседневных задач', en: 'Great for everyday tasks' },
  'umenu.open': { ru: 'Меню профиля', en: 'Profile menu' },
  'umenu.changePlan': { ru: 'Изменить план', en: 'Change plan' },
  'umenu.help': { ru: 'Справка', en: 'Help' },
  'umenu.terms': { ru: 'Условия использования', en: 'Terms of use' },
  'umenu.privacy': { ru: 'Политика конфиденциальности', en: 'Privacy policy' },
  'umenu.reportBug': { ru: 'Сообщить об ошибке', en: 'Report a bug' },
  'rail.pinnedGroup': { ru: 'Закреплено', en: 'Pinned' },
  'rail.today': { ru: 'Сегодня', en: 'Today' },
  'rail.yesterday': { ru: 'Вчера', en: 'Yesterday' },
  'rail.prev7': { ru: 'Последние 7 дней', en: 'Previous 7 days' },
  'rail.chatMenu': { ru: 'Меню чата', en: 'Chat menu' },
  'rail.pin': { ru: 'Закрепить', en: 'Pin' },
  'rail.unpin': { ru: 'Открепить', en: 'Unpin' },
  'rail.rename': { ru: 'Переименовать', en: 'Rename' },
  'rail.archive': { ru: 'Архивировать', en: 'Archive' },
  'rail.delete': { ru: 'Удалить', en: 'Delete' },
  'rail.collapse': { ru: 'Свернуть панель', en: 'Collapse sidebar' },
  'rail.expand': { ru: 'Развернуть панель', en: 'Expand sidebar' },
  'rail.archivedToast': { ru: 'Чат перемещён в архив.', en: 'Chat archived.' },
  'rail.deletedToast': { ru: 'Чат удалён.', en: 'Chat deleted.' },

  // Archive
  'archive.title': { ru: 'Архив', en: 'Archive' },
  'archive.sub': { ru: 'Архивированные чаты: верните их в список или удалите насовсем.', en: 'Archived chats: restore them to the sidebar or delete for good.' },
  'archive.emptyTitle': { ru: 'Архив пуст', en: 'Archive is empty' },
  'archive.emptyBody': { ru: 'Архивируйте чаты через меню «⋯» в боковой панели.', en: 'Archive chats via the “⋯” menu in the sidebar.' },
  'archive.colChat': { ru: 'Чат', en: 'Chat' },
  'archive.open': { ru: 'Открыть', en: 'Open' },
  'archive.restore': { ru: 'Вернуть', en: 'Restore' },
  'archive.restored': { ru: 'Чат возвращён в список.', en: 'Chat restored.' },

  // Settings · security
  'settings.security': { ru: 'Безопасность', en: 'Security' },
  'settings.securitySub': { ru: 'Пароль и управление аккаунтом.', en: 'Password and account management.' },
  'settings.currentPassword': { ru: 'Текущий пароль', en: 'Current password' },
  'settings.newPassword': { ru: 'Новый пароль (мин. 8 символов)', en: 'New password (min 8 characters)' },
  'settings.confirmPassword': { ru: 'Повторите новый пароль', en: 'Repeat new password' },
  'settings.changePassword': { ru: 'Сменить пароль', en: 'Change password' },
  'settings.passwordChanged': { ru: 'Пароль обновлён.', en: 'Password updated.' },
  'settings.passwordMismatch': { ru: 'Пароли не совпадают.', en: 'Passwords do not match.' },
  'settings.deleteAccount': { ru: 'Удалить аккаунт', en: 'Delete account' },
  'settings.deleteWarn': {
    ru: 'Удалятся все документы, анализы, чаты и подписи. Это действие необратимо.',
    en: 'All documents, analyses, chats and signatures will be deleted. This cannot be undone.',
  },
  'settings.deleteConfirmLabel': { ru: 'Введите email аккаунта для подтверждения', en: 'Type your account email to confirm' },
  'settings.deleted': { ru: 'Аккаунт удалён.', en: 'Account deleted.' },

  // Auth · terms links
  'auth.termsA': { ru: 'Продолжая, вы принимаете ', en: 'By continuing, you agree to the ' },
  'auth.termsOfUse': { ru: 'Условия использования', en: 'Terms of Use' },
  'auth.termsAnd': { ru: ' и ', en: ' and the ' },
  'auth.privacyPolicy': { ru: 'Политику конфиденциальности', en: 'Privacy Policy' },
  'auth.termsB': { ru: ' Lexab.', en: ' of Lexab.' },

  // Compare
  'cmp.uploadA': { ru: 'Версия A (старая)', en: 'Version A (older)' },
  'cmp.uploadB': { ru: 'Версия B (новая)', en: 'Version B (newer)' },
  'cmp.pick': { ru: 'Выбрать файл', en: 'Choose file' },
  'cmp.run': { ru: 'Сравнить версии', en: 'Compare versions' },
  'cmp.hint': { ru: 'Поддерживаются DOCX, TXT и цифровые PDF (не сканы).', en: 'DOCX, TXT and digital PDFs are supported (not scans).' },
  'cmp.aiSummary': { ru: 'Вывод ИИ', en: 'AI summary' },
  'cmp.empty': { ru: 'Загрузите две версии договора — ИИ покажет, что изменилось и как сместился риск.', en: 'Upload two versions of a contract — the AI shows what changed and how the risk shifted.' },

  // Templates · generator
  'tpl.generate': { ru: 'Создать черновик', en: 'Create draft' },
  'tpl.genTitle': { ru: 'Новый документ из шаблона', en: 'New document from template' },
  'tpl.partyA': { ru: 'Сторона A (вы)', en: 'Party A (you)' },
  'tpl.partyB': { ru: 'Сторона B (контрагент)', en: 'Party B (counterparty)' },
  'tpl.jurisdiction': { ru: 'Юрисдикция', en: 'Jurisdiction' },
  'tpl.term': { ru: 'Срок действия', en: 'Term' },
  'tpl.termPh': { ru: 'например, 12 месяцев', en: 'e.g. 12 months' },
  'tpl.details': { ru: 'Кратко опишите договор', en: 'Describe the contract briefly' },
  'tpl.detailsPh': {
    ru: 'что за сделка и ключевые условия — например: агент продаёт нашу косметику в Ташкенте, вознаграждение 10%, предоплата 50%, неустойка 0,1% в день…',
    en: 'what the deal is and key terms — e.g.: agent sells our cosmetics in Tashkent, 10% commission, 50% prepayment, 0.1% daily penalty…',
  },
  'tpl.genRun': { ru: 'Сгенерировать', en: 'Generate' },
  'tpl.genReady': { ru: 'Черновик готов', en: 'Draft ready' },
  'tpl.download': { ru: 'Скачать .doc', en: 'Download .doc' },
  'tpl.copy': { ru: 'Копировать', en: 'Copy' },
  'tpl.copied': { ru: 'Скопировано в буфер обмена.', en: 'Copied to clipboard.' },
  'tpl.saveAsTemplate': { ru: 'Сохранить как шаблон', en: 'Save as template' },
  'tpl.savedToast': { ru: 'Шаблон сохранён в вашей библиотеке.', en: 'Saved to your library.' },
  'tpl.mySaved': { ru: 'Мои шаблоны', en: 'My templates' },
  'tpl.view': { ru: 'Открыть', en: 'Open' },
  'tpl.delete': { ru: 'Удалить', en: 'Delete' },
  'tpl.deletedToast': { ru: 'Шаблон удалён.', en: 'Template deleted.' },

  // Workspace
  'ws.report': { ru: 'Отчёт (PDF)', en: 'Report (PDF)' },
  'ws.saved': { ru: 'Изменения сохранены.', en: 'Changes saved.' },
  // ── Rich-text editing toolbar ──
  'editor.toolbar': { ru: 'Панель редактирования', en: 'Editing toolbar' },
  'editor.style': { ru: 'Стиль', en: 'Style' },
  'editor.heading1': { ru: 'Заголовок', en: 'Heading' },
  'editor.heading2': { ru: 'Подзаголовок', en: 'Subheading' },
  'editor.body': { ru: 'Обычный текст', en: 'Body text' },
  'editor.bulletList': { ru: 'Маркированный список', en: 'Bulleted list' },
  'editor.numberedList': { ru: 'Нумерованный список', en: 'Numbered list' },
  'editor.bold': { ru: 'Жирный', en: 'Bold' },
  'editor.italic': { ru: 'Курсив', en: 'Italic' },
  'editor.underline': { ru: 'Подчёркнутый', en: 'Underline' },
  'editor.strikethrough': { ru: 'Зачёркнутый', en: 'Strikethrough' },
  'editor.alignLeft': { ru: 'По левому краю', en: 'Align left' },
  'editor.alignCenter': { ru: 'По центру', en: 'Align center' },
  'editor.alignRight': { ru: 'По правому краю', en: 'Align right' },
  'editor.link': { ru: 'Ссылка', en: 'Link' },
  'editor.linkPrompt': { ru: 'Введите адрес ссылки:', en: 'Enter the link address:' },
  'editor.cut': { ru: 'Вырезать', en: 'Cut' },
  'editor.copy': { ru: 'Копировать', en: 'Copy' },
  'editor.paste': { ru: 'Вставить', en: 'Paste' },
  'editor.pasteUnsupported': { ru: 'Вставьте через Ctrl+V (браузер запрещает вставку кнопкой).', en: 'Use Ctrl+V to paste (the browser blocks button paste).' },
  'editor.undo': { ru: 'Отменить', en: 'Undo' },
  'editor.redo': { ru: 'Повторить', en: 'Redo' },
  'editor.showEdits': { ru: 'Показать правки', en: 'Show edits' },
  'editor.versionHistory': { ru: 'История версий', en: 'Version history' },
  'editor.close': { ru: 'Закрыть', en: 'Close' },
  'ws.versionsTitle': { ru: 'История версий', en: 'Version history' },
  'ws.noVersions': {
    ru: 'Версий пока нет — они появятся после загрузки и анализа документа.',
    en: 'No versions yet — they will appear once the document is uploaded and analysed.',
  },
  'ws.reanalyzing': { ru: 'Запускаю повторный анализ текущего черновика…', en: 'Re-analysing the current draft…' },
  'ws.reanalyzed': {
    ru: 'Повторный анализ готов: риск {score}/100, правок: {n}.',
    en: 'Re-analysis complete: risk {score}/100, {n} redlines.',
  },
  'docs.signSent': { ru: 'Запрос на подпись отправлен.', en: 'Signature request sent.' },
  'docs.docxReady': { ru: 'DOCX скачан.', en: 'DOCX downloaded.' },
  'docs.noAnalysis': {
    ru: 'Для этого документа ещё нет ИИ-анализа. Загрузите его в чат — и обзор появится здесь.',
    en: 'No AI review for this document yet. Upload it in the chat to get one.',
  },
  'sig.detailTitle': { ru: 'Запрос на подпись', en: 'Signature request' },
  'sig.signedYes': { ru: 'Подпись получена', en: 'Signed' },
  'sig.waiting': { ru: 'Ожидает', en: 'Waiting' },
  'country.aiNote': {
    ru: 'Юрисдикция по умолчанию: {law}. ИИ учтёт её в анализах и ответах.',
    en: 'Default jurisdiction: {law}. The AI will use it for reviews and answers.',
  },
  'country.selectorAria': { ru: 'Юрисдикция: {name}', en: 'Jurisdiction: {name}' },

  // Templates
  'tpl.title': { ru: 'Шаблоны', en: 'Templates' },
  'tpl.sub': { ru: 'Начните черновик из проверенного шаблона под юрисдикцию.', en: 'Start a draft from a vetted, jurisdiction-ready template.' },
  'tpl.allCategories': { ru: 'Все категории', en: 'All categories' },
  'tpl.search': { ru: 'Поиск шаблона…', en: 'Search templates…' },
  'tpl.empty': { ru: 'Нет шаблонов в этой категории', en: 'No templates in this category' },
  'tpl.clauses': { ru: 'пунктов', en: 'clauses' },

  // Signatures
  'sig.title': { ru: 'Э-подписи', en: 'E-signatures' },
  'sig.sub': { ru: 'Отслеживайте документы, отправленные на подпись.', en: 'Track documents sent for signing and their progress.' },
  'sig.col.document': { ru: 'Документ', en: 'Document' },
  'sig.col.status': { ru: 'Статус', en: 'Status' },
  'sig.col.recipients': { ru: 'Получатели', en: 'Recipients' },
  'sig.col.sent': { ru: 'Отправлено', en: 'Sent' },
  'sig.signed': { ru: '{a} / {b} подписано', en: '{a} / {b} signed' },
  'sig.empty': { ru: 'Пока нет запросов на подпись', en: 'No signature requests yet' },
  'sig.emptyBody': { ru: 'Откройте проверенный контракт и выберите «Отправить на подпись».', en: 'Open a reviewed contract and choose “Send for e-signature”.' },
  // Названия функций для отказов по тарифу (см. i18n/apiError.ts) — остальные
  // берутся из заголовков разделов, отдельные ключи нужны только тем, у кого
  // своей страницы нет.
  'feat.docxExport': { ru: 'Экспорт в DOCX', en: 'DOCX export' },
  'feat.versions': { ru: 'История версий', en: 'Version history' },
  'feat.sso': { ru: 'Единый вход (SSO)', en: 'Single Sign-On (SSO)' },
  'feat.workflows': { ru: 'Агентные сценарии', en: 'Agentic workflows' },
  'plan.upsellTitle': { ru: 'Функция старших тарифов', en: 'Available on higher plans' },
  'limits.featureLocked': {
    ru: '«{feature}» доступно на тарифах {plans} (у вас {plan}). Обновите тариф в разделе «Тарифы».',
    en: '“{feature}” is available on {plans} (you are on {plan}). Upgrade on the Plans page.',
  },
  'limits.aiLimit': {
    ru: 'Лимит ИИ-запросов тарифа {plan} исчерпан ({limit} в месяц). Счётчик обнулится 1-го числа.',
    en: 'The {plan} plan\u2019s AI limit is used up ({limit} per month). The counter resets on the 1st.',
  },
  'limits.docsLimit': {
    ru: 'Лимит документов тарифа {plan} исчерпан ({limit} в месяц). Счётчик обнулится 1-го числа.',
    en: 'The {plan} plan\u2019s document limit is used up ({limit} per month). The counter resets on the 1st.',
  },
  'limits.storageLimit': {
    ru: 'Хранилище тарифа {plan} заполнено ({used} из {limit} МБ). Удалите ненужные файлы или обновите тариф.',
    en: 'The {plan} plan\u2019s storage is full ({used} of {limit} MB). Delete files or upgrade your plan.',
  },
  'limits.seatsLimit': {
    ru: 'В команде тарифа {plan} не больше {limit} участников. Освободите место или напишите нам про Enterprise.',
    en: 'The {plan} plan allows up to {limit} team members. Free a seat or contact us about Enterprise.',
  },
  'sig.soon': { ru: 'Электронные подписи скоро', en: 'E-signatures are coming soon' },
  'sig.soonBody': {
    ru: 'Мы подключаем E-IMZO — государственную электронную подпись. До этого раздел закрыт: подпись без юридической силы в договоре хуже, чем её отсутствие.',
    en: 'We are integrating E-IMZO, the state e-signature service. Until then the section stays closed: a signature without legal force is worse than none at all.',
  },

  // Analytics
  'an.title': { ru: 'Аналитика', en: 'Analytics' },
  'an.sub': { ru: 'Ваша активность по обзору контрактов за 6 недель.', en: 'Your contract review activity over the last six weeks.' },
  'an.contractsReviewed': { ru: 'Проверок проведено', en: 'Reviews run' },
  'an.avgRisk': { ru: 'Средний риск', en: 'Avg. risk score' },
  'an.highRisk': { ru: 'Находок высокого риска', en: 'High-risk findings' },
  'an.hoursSaved': { ru: 'Сэкономлено часов (оценка)', en: 'Hours saved (est.)' },
  'an.hours': { ru: 'ч', en: 'hrs' },
  'an.perWeek': { ru: 'Обзоров в неделю', en: 'Reviews per week' },
  'an.bySeverity': { ru: 'Находки по серьёзности', en: 'Findings by severity' },
  'an.monthly': { ru: 'Активность по месяцам', en: 'Activity by month' },
  'an.series.reviews': { ru: 'Проверки', en: 'Reviews' },
  'an.series.findings': { ru: 'Находки', en: 'Findings' },
  'an.donutTotal': { ru: 'Всего', en: 'Total' },
  'an.noData': { ru: 'Пока нет данных', en: 'No data yet' },
  'an.riskCenter': { ru: 'Центр рисков', en: 'Risk centre' },
  'an.riskCenterSub': { ru: 'Где сосредоточен риск вашего портфеля договоров.', en: 'Where the risk in your contract portfolio sits.' },
  'an.topContracts': { ru: 'Самые опасные договоры', en: 'Highest-risk contracts' },
  'an.byJurisdiction': { ru: 'Риски по странам', en: 'Risk by country' },
  'an.byCounterparty': { ru: 'Риски по контрагентам', en: 'Risk by counterparty' },
  'an.highCount': { ru: '{n} выс.', en: '{n} high' },
  'an.compliance': { ru: 'Контроль соответствия', en: 'Compliance monitoring' },
  'an.complianceSub': { ru: 'Насколько выводы ИИ подтверждены официальной базой законов.', en: 'How much of the AI output is backed by the official statute base.' },
  'an.citations': { ru: 'Цитаты законов в находках', en: 'Statute citations in findings' },
  'an.citationsVerifiedShare': { ru: 'подтверждено по базе законодательства', en: 'verified against the legislation base' },
  'an.citationsVerified': { ru: 'Подтверждённые цитаты', en: 'Verified citations' },
  'an.citationsUnverified': { ru: 'Непроверенные цитаты', en: 'Unverified citations' },
  'an.corpus': { ru: 'База законов: свежесть', en: 'Statute base freshness' },
  'an.corpusDocs': { ru: '{n} акт(ов)', en: '{n} act(s)' },
  'an.corpusNote': { ru: 'Тексты законов загружаются только из официальных источников; дата — последнее обновление из источника.', en: 'Statute texts come only from official sources; the date is the last refresh from the source.' },
  'an.team': { ru: 'Нагрузка команды', en: 'Team workload' },
  'an.teamSub': { ru: 'Кто сколько проверяет в рамках вашей команды (личная работа участников вне команды сюда не попадает).', en: 'Who reviews how much within your team (members’ work outside the team never shows here).' },
  'an.teamMember': { ru: 'Участник', en: 'Member' },
  'an.teamReviews30': { ru: 'Проверок за 30 дней', en: 'Reviews, 30 days' },
  'an.teamTotal': { ru: 'Всего', en: 'Total' },
  'an.teamLastActive': { ru: 'Последняя активность', en: 'Last active' },

  // Team
  'team.title': { ru: 'Команда', en: 'Team' },
  'team.sub': { ru: 'Участники рабочего пространства и их роли (план Business).', en: 'Workspace members and their roles (Business plan).' },
  'team.invite': { ru: 'Пригласить участника', en: 'Invite member' },
  'team.inviteSent': { ru: 'Приглашение отправлено.', en: 'Invitation sent.' },
  'team.col.member': { ru: 'Участник', en: 'Member' },
  'team.col.role': { ru: 'Роль', en: 'Role' },
  'team.col.status': { ru: 'Статус', en: 'Status' },
  'sso.title': { ru: 'Единый вход (SSO)', en: 'Single Sign-On (SSO)' },
  'sso.sub': { ru: 'Настройте вход сотрудников через вашего провайдера (Google Workspace, Microsoft Entra и др.).', en: 'Let staff sign in through your identity provider (Google Workspace, Microsoft Entra, etc.).' },
  'sso.upsellTitle': { ru: 'SSO — на тарифе Business', en: 'SSO is a Business feature' },
  'sso.upsellBody': { ru: 'Единый корпоративный вход доступен на тарифе Business.', en: 'Corporate single sign-on is available on the Business plan.' },
  'sso.issuer': { ru: 'Issuer URL провайдера', en: 'Provider issuer URL' },
  'sso.clientId': { ru: 'Client ID', en: 'Client ID' },
  'sso.clientSecret': { ru: 'Client Secret', en: 'Client secret' },
  'sso.clientSecretSet': { ru: 'Client Secret (задан)', en: 'Client secret (set)' },
  'sso.secretStored': { ru: 'сохранён', en: 'stored' },
  'sso.domain': { ru: 'Домен корпоративной почты', en: 'Corporate email domain' },
  'sso.defaultRole': { ru: 'Роль по умолчанию', en: 'Default role' },
  'sso.save': { ru: 'Сохранить настройки', en: 'Save settings' },
  'sso.saved': { ru: 'Настройки SSO сохранены.', en: 'SSO settings saved.' },
  'sso.fillAll': { ru: 'Заполните все поля.', en: 'Fill in all fields.' },
  'sso.redirectUri': { ru: 'Redirect URI (укажите у провайдера)', en: 'Redirect URI (add at your provider)' },
  'sso.dnsRecord': { ru: 'DNS TXT-запись (для подтверждения домена)', en: 'DNS TXT record (for domain verification)' },
  'sso.domainStatus': { ru: 'Домен', en: 'Domain' },
  'sso.verified': { ru: 'Подтверждён', en: 'Verified' },
  'sso.unverified': { ru: 'Не подтверждён', en: 'Not verified' },
  'sso.verifyDomain': { ru: 'Проверить домен', en: 'Verify domain' },
  'sso.verifyOk': { ru: 'Домен подтверждён.', en: 'Domain verified.' },
  'sso.verifyFail': { ru: 'DNS-запись не найдена. Добавьте её и попробуйте снова.', en: 'DNS record not found. Add it and try again.' },
  'sso.enable': { ru: 'Включить вход через SSO', en: 'Enable SSO sign-in' },
  'sso.enforce': { ru: 'Требовать SSO для сотрудников домена', en: 'Require SSO for the domain’s members' },
  'sso.copied': { ru: 'Скопировано.', en: 'Copied.' },
  'audit.title': { ru: 'Журнал действий', en: 'Audit log' },
  'audit.upsellTitle': { ru: 'Журнал действий — на тарифе Business', en: 'Audit log is a Business feature' },
  'audit.upsellBody': { ru: 'Полный след действий команды (входы, документы, ИИ, оплаты) доступен на тарифе Business.', en: 'A full trail of team activity (logins, documents, AI, billing) is available on the Business plan.' },
  'audit.allGroups': { ru: 'Все события', en: 'All events' },
  'audit.allActors': { ru: 'Все участники', en: 'All members' },
  'audit.event.auth.register': { ru: 'Регистрация', en: 'Registration' },
  'audit.event.auth.login': { ru: 'Вход', en: 'Sign-in' },
  'audit.event.auth.login_failed': { ru: 'Неудачный вход', en: 'Failed sign-in' },
  'audit.event.auth.logout': { ru: 'Выход', en: 'Sign-out' },
  'audit.event.auth.refresh': { ru: 'Продление сессии', en: 'Session refresh' },
  'audit.event.auth.password_changed': { ru: 'Смена пароля', en: 'Password changed' },
  'audit.event.auth.password_reset': { ru: 'Сброс пароля', en: 'Password reset' },
  'audit.event.auth.account_deleted': { ru: 'Удаление аккаунта', en: 'Account deleted' },
  'audit.event.auth.google_login': { ru: 'Вход через Google', en: 'Google sign-in' },
  'audit.event.security.bruteforce_alert': { ru: 'Подозрение на подбор пароля', en: 'Brute-force alert' },
  'audit.event.team.invited': { ru: 'Приглашение в команду', en: 'Team invitation' },
  'audit.event.team.invite_accepted': { ru: 'Приглашение принято', en: 'Invitation accepted' },
  'audit.event.team.role_changed': { ru: 'Смена роли', en: 'Role changed' },
  'audit.event.team.member_removed': { ru: 'Участник удалён', en: 'Member removed' },
  'audit.event.document.shared': { ru: 'Документ открыт команде', en: 'Document shared' },
  'audit.event.document.unshared': { ru: 'Доступ команды закрыт', en: 'Sharing revoked' },
  'audit.event.document.deleted': { ru: 'Документ удалён', en: 'Document deleted' },
  'audit.event.document.exported': { ru: 'Экспорт документа', en: 'Document exported' },
  'audit.event.ai.analysis': { ru: 'ИИ-анализ договора', en: 'AI contract analysis' },
  'audit.event.ai.chat': { ru: 'Вопрос ИИ-ассистенту', en: 'AI chat message' },
  'audit.event.ai.draft': { ru: 'ИИ-черновик договора', en: 'AI contract draft' },
  'audit.event.ai.compare': { ru: 'ИИ-сравнение версий', en: 'AI version compare' },
  'audit.event.redline.accepted': { ru: 'Правка принята', en: 'Redline accepted' },
  'audit.event.redline.rejected': { ru: 'Правка отклонена', en: 'Redline rejected' },
  'audit.event.file.uploaded': { ru: 'Файл загружен', en: 'File uploaded' },
  'audit.event.file.deleted': { ru: 'Файл удалён', en: 'File deleted' },
  'audit.event.file.downloaded': { ru: 'Файл скачан', en: 'File downloaded' },
  'audit.event.signature.requested': { ru: 'Отправлено на подпись', en: 'Signature requested' },
  'audit.event.signature.completed': { ru: 'Документ подписан', en: 'Signature completed' },
  'audit.event.approval.started': { ru: 'Согласование запущено', en: 'Approval started' },
  'audit.event.approval.decided': { ru: 'Решение по согласованию', en: 'Approval decision' },
  'audit.event.billing.checkout': { ru: 'Оплата тарифа', en: 'Plan checkout' },
  'audit.event.sso.config_changed': { ru: 'Настройки SSO изменены', en: 'SSO settings changed' },
  'audit.event.sso.login': { ru: 'Вход через SSO', en: 'SSO sign-in' },
  'audit.event.sso.enforcement_denied': { ru: 'Вход SSO отклонён', en: 'SSO sign-in denied' },
  'audit.searchPlaceholder': { ru: 'Поиск по журналу…', en: 'Search the trail…' },
  'audit.group.auth': { ru: 'Вход и безопасность', en: 'Auth & security' },
  'audit.group.document': { ru: 'Документы', en: 'Documents' },
  'audit.group.ai': { ru: 'ИИ', en: 'AI' },
  'audit.group.team': { ru: 'Команда', en: 'Team' },
  'audit.group.billing': { ru: 'Оплата', en: 'Billing' },
  'audit.group.signature': { ru: 'Подписи', en: 'Signatures' },
  'audit.group.security': { ru: 'Безопасность', en: 'Security' },
  'audit.exportCsv': { ru: 'Экспорт CSV', en: 'Export CSV' },
  'audit.empty': { ru: 'Пока нет событий', en: 'No events yet' },
  'audit.loadMore': { ru: 'Показать ещё', en: 'Load more' },
  'audit.colTime': { ru: 'Время', en: 'Time' },
  'audit.colActor': { ru: 'Кто', en: 'Actor' },
  'audit.colEvent': { ru: 'Событие', en: 'Event' },
  'audit.colTarget': { ru: 'Объект', en: 'Target' },
  'audit.colIp': { ru: 'IP', en: 'IP' },

  // Security controls (2FA, sessions, data export, access review)
  'sec.copied': { ru: 'Скопировано.', en: 'Copied.' },
  'sec.copyHint': { ru: 'Нажмите, чтобы скопировать', en: 'Click to copy' },
  'sec.2fa.title': { ru: 'Двухфакторная аутентификация', en: 'Two-factor authentication' },
  'sec.2fa.sub': {
    ru: 'Дополнительный код из приложения-аутентификатора при входе — надёжная защита аккаунта.',
    en: 'A one-time code from an authenticator app at sign-in — strong account protection.',
  },
  'sec.2fa.enable': { ru: 'Включить 2FA', en: 'Enable 2FA' },
  'sec.2fa.enabled': { ru: '2FA включена', en: '2FA is on' },
  'sec.2fa.remaining': { ru: 'резервных кодов осталось: {n}', en: '{n} backup codes left' },
  'sec.2fa.disable': { ru: 'Отключить', en: 'Disable' },
  'sec.2fa.setupIntro': {
    ru: 'Добавьте ключ в приложение (Google Authenticator, 1Password и др.): отсканируйте ссылку или введите ключ вручную, затем подтвердите кодом.',
    en: 'Add the key to your app (Google Authenticator, 1Password, etc.): scan the link or enter the key manually, then confirm with a code.',
  },
  'sec.2fa.keyLabel': { ru: 'Ключ для ручного ввода', en: 'Manual entry key' },
  'sec.2fa.uriLabel': { ru: 'Ссылка otpauth', en: 'otpauth link' },
  'sec.2fa.codeLabel': { ru: '6-значный код из приложения', en: '6-digit code from the app' },
  'sec.2fa.backupCodeLabel': { ru: 'Резервный код', en: 'Backup code' },
  'sec.2fa.confirm': { ru: 'Подтвердить и включить', en: 'Confirm and enable' },
  'sec.2fa.verify': { ru: 'Подтвердить', en: 'Verify' },
  'sec.2fa.invalidCode': { ru: 'Неверный код. Попробуйте ещё раз.', en: 'Invalid code. Try again.' },
  'sec.2fa.codeRequired': { ru: 'Введите код подтверждения.', en: 'Enter the verification code.' },
  'sec.2fa.useBackupCode': { ru: 'Использовать резервный код', en: 'Use a backup code instead' },
  'sec.2fa.useAppCode': { ru: 'Ввести код из приложения', en: 'Use an app code instead' },
  'sec.2fa.backupTitle': { ru: 'Сохраните резервные коды', en: 'Save your backup codes' },
  'sec.2fa.backupWarn': {
    ru: 'Сохраните эти коды сейчас — они показываются один раз. Каждый код одноразовый и понадобится, если вы потеряете доступ к приложению.',
    en: 'Save these now — they are shown only once. Each code works once and lets you back in if you lose your authenticator.',
  },
  'sec.2fa.copyCodes': { ru: 'Скопировать коды', en: 'Copy codes' },
  'sec.2fa.backupSaved': { ru: 'Я сохранил коды', en: "I've saved them" },
  'sec.2fa.passwordLabel': { ru: 'Пароль аккаунта', en: 'Account password' },
  'sec.2fa.confirmDisable': { ru: 'Отключить 2FA', en: 'Disable 2FA' },
  'sec.2fa.wrongPassword': { ru: 'Неверный пароль.', en: 'Wrong password.' },
  'sec.2fa.disabled': { ru: 'Двухфакторная аутентификация отключена.', en: 'Two-factor authentication disabled.' },
  'sec.sessions.title': { ru: 'Активные сессии', en: 'Active sessions' },
  'sec.sessions.sub': {
    ru: 'Устройства, на которых выполнен вход в аккаунт.',
    en: 'Devices currently signed in to your account.',
  },
  'sec.sessions.unknownDevice': { ru: 'Неизвестное устройство', en: 'Unknown device' },
  'sec.sessions.signOutAll': { ru: 'Выйти на всех устройствах', en: 'Sign out everywhere' },
  'sec.sessions.revoked': { ru: 'Остальные сессии завершены.', en: 'Other sessions signed out.' },
  'sec.export.title': { ru: 'Экспорт данных', en: 'Data export' },
  'sec.export.sub': {
    ru: 'Скачайте копию своих данных — профиль, документы, анализы и историю чатов — одним понятным файлом, который открывается в браузере.',
    en: 'Download a copy of your data — profile, documents, reviews and chat history — as one readable file that opens in your browser.',
  },
  'sec.export.button': { ru: 'Скачать мои данные', en: 'Download my data' },
  'sec.export.failed': { ru: 'Не удалось скачать данные.', en: 'Could not download your data.' },
  'sec.access.title': { ru: 'Обзор доступа', en: 'Access review' },
  'sec.access.sub': {
    ru: 'Кто имеет доступ к рабочему пространству, их роли и последняя активность — для периодической проверки прав.',
    en: 'Who has access to the workspace, their roles and last activity — for periodic access reviews.',
  },
  'sec.access.colLastActive': { ru: 'Активность', en: 'Last active' },
  'sec.access.exportCsv': { ru: 'Скачать CSV', en: 'Download CSV' },
  'sec.access.upsellTitle': { ru: 'Обзор доступа — на тарифе Business', en: 'Access review is a Business feature' },
  'sec.access.upsellBody': {
    ru: 'Отчёт по доступу команды с выгрузкой в CSV доступен на тарифе Business.',
    en: 'A team access report with CSV export is available on the Business plan.',
  },
  'team.role.owner': { ru: 'Владелец', en: 'Owner' },
  'team.role.admin': { ru: 'Админ', en: 'Admin' },
  'team.role.editor': { ru: 'Редактор', en: 'Editor' },
  'team.role.viewer': { ru: 'Наблюдатель', en: 'Viewer' },
  'team.status.active': { ru: 'Активен', en: 'Active' },
  'team.status.invited': { ru: 'Приглашён', en: 'Invited' },
  'team.inviteEmail': { ru: 'Email пользователя', en: "User's email" },
  'team.inviteRole': { ru: 'Права доступа', en: 'Access level' },
  'team.inviteTitle': { ru: 'Должность', en: 'Job title' },
  'team.inviteSend': { ru: 'Отправить приглашение', en: 'Send invitation' },
  'team.inviteHint': {
    ru: 'Участник появится в команде только после того, как примет приглашение в приложении.',
    en: 'The person joins the team only after accepting the invitation in the app.',
  },
  'team.invitedYou': { ru: '{name} ({firm}) приглашает вас в команду', en: '{name} ({firm}) invited you to their team' },
  'team.accept': { ru: 'Принять', en: 'Accept' },
  'team.decline': { ru: 'Отклонить', en: 'Decline' },
  'team.acceptedToast': { ru: 'Вы присоединились к команде.', en: 'You joined the team.' },
  'team.declinedToast': { ru: 'Приглашение отклонено.', en: 'Invitation declined.' },

  // Top bar
  'top.upgrade': { ru: 'Обновить', en: 'Upgrade' },
  'top.theme.toLight': { ru: 'Светлая тема', en: 'Light theme' },
  'top.theme.toDark': { ru: 'Тёмная тема', en: 'Dark theme' },
  'top.notFound': { ru: 'Ничего не найдено', en: 'No results' },
  'top.notifications': { ru: 'Уведомления', en: 'Notifications' },
  'top.markAllRead': { ru: 'Отметить все', en: 'Mark all read' },
  'top.noNotifications': { ru: 'Пока нет уведомлений', en: 'No notifications yet' },
  'top.notifOpen': { ru: 'Открыть', en: 'Open' },
  'top.settings': { ru: 'Настройки', en: 'Settings' },

  // Settings menu (gear in the top bar)
  'settings.themeGroup': { ru: 'Тема оформления', en: 'Appearance' },
  'settings.theme.light': { ru: 'Светлая тема', en: 'Light theme' },
  'settings.theme.dark': { ru: 'Тёмная тема', en: 'Dark theme' },
  'settings.theme.standard': { ru: 'Стандартная тема', en: 'Standard theme' },
  'settings.feedback': { ru: 'Обратная связь', en: 'Feedback' },
  'settings.plans': { ru: 'Тарифы и оплата', en: 'Plans & billing' },

  // Feedback form
  'feedback.title': { ru: 'Обратная связь', en: 'Feedback' },
  'feedback.placeholder': { ru: 'Дайте нам свой отзыв', en: 'Give us your feedback' },
  'feedback.send': { ru: 'Отправить', en: 'Send' },
  'feedback.sending': { ru: 'Отправляем…', en: 'Sending…' },
  'feedback.sent': { ru: 'Спасибо! Мы получили ваш отзыв', en: 'Thank you! Feedback received' },
  'feedback.attach': { ru: 'Вложения', en: 'Attachments' },
  'feedback.attachHint': { ru: 'Перетащите изображения сюда или нажмите, чтобы выбрать', en: 'Drag images here or click to browse' },
  'feedback.tooMany': { ru: 'Не больше 5 файлов', en: 'Up to 5 files' },
  'feedback.tooBig': { ru: 'Файл слишком большой (до 2 МБ)', en: 'File is too large (2 MB max)' },
  'feedback.tooLarge': { ru: 'Вложения не должны превышать 8 МБ', en: 'Attachments must total 8 MB or less' },
  'feedback.imagesOnly': { ru: 'Только изображения (PNG, JPG, WebP, GIF)', en: 'Images only (PNG, JPG, WebP, GIF)' },
  'feedback.type': { ru: 'Тип отзыва', en: 'Feedback type' },
  'feedback.typeOptional': { ru: '(необязательно)', en: '(optional)' },
  'feedback.typePlaceholder': { ru: 'Выберите тип отзыва', en: 'Choose feedback type' },
  'fbcat.general': { ru: 'Общие замечания', en: 'General feedback' },
  'fbcat.bug': { ru: 'Проблема или ошибка в работе', en: 'Bug or technical issue' },
  'fbcat.legal': { ru: 'Неточность в правовой информации', en: 'Legal information inaccuracy' },
  'fbcat.quality': { ru: 'Качество ответов ИИ', en: 'AI answer quality' },
  'fbcat.feature': { ru: 'Предложение функции', en: 'Feature request' },
  'fbcat.billing': { ru: 'Тарифы и оплата', en: 'Plans & billing' },

  // Finding severities (chat summary + analytics legend)
  'sev.High': { ru: 'Высокая', en: 'High' },
  'sev.Medium': { ru: 'Средняя', en: 'Medium' },
  'sev.Low': { ru: 'Низкая', en: 'Low' },

  // Citation verification badge (statute corpus)
  'finding.verified': { ru: 'Проверено по базе законодательства', en: 'Verified against legislation database' },
  'finding.unverified': { ru: 'Источник не подтверждён', en: 'Source not confirmed' },

  // Playbooks — team standard positions the AI checks contracts against
  'playbooks.title': { ru: 'Плейбуки', en: 'Playbooks' },
  'playbooks.sub': {
    ru: 'Стандартные позиции команды — ИИ помечает отклонения при анализе договоров.',
    en: 'Your team’s standard positions — the AI flags deviations while analysing contracts.',
  },
  'playbooks.new': { ru: 'Новый плейбук', en: 'New playbook' },
  'playbooks.create': { ru: 'Создать плейбук', en: 'Create playbook' },
  'playbooks.edit': { ru: 'Редактировать плейбук', en: 'Edit playbook' },
  'playbooks.name': { ru: 'Название', en: 'Name' },
  'playbooks.namePh': { ru: 'Например: Стандартные позиции по NDA', en: 'e.g. Standard NDA positions' },
  'playbooks.jurisdiction': { ru: 'Юрисдикция', en: 'Jurisdiction' },
  'playbooks.allJurisdictions': { ru: 'Все юрисдикции', en: 'All jurisdictions' },
  'playbooks.rules': { ru: 'Правила', en: 'Rules' },
  'playbooks.rulesHint': {
    ru: 'Каждое правило — одна позиция, например «Неустойка не выше 0,1% в день».',
    en: 'One position per rule, e.g. “Late-payment penalty no higher than 0.1% per day”.',
  },
  'playbooks.rulePh': { ru: 'Опишите стандартную позицию…', en: 'Describe a standard position…' },
  'playbooks.addRule': { ru: 'Добавить правило', en: 'Add rule' },
  'playbooks.removeRule': { ru: 'Удалить правило', en: 'Remove rule' },
  'playbooks.active': { ru: 'Активен', en: 'Active' },
  'playbooks.activeHint': {
    ru: 'ИИ проверяет договоры по активным плейбукам.',
    en: 'The AI checks contracts against active playbooks.',
  },
  'playbooks.activeBadge': { ru: 'Активен', en: 'Active' },
  'playbooks.inactiveBadge': { ru: 'Выключен', en: 'Off' },
  'playbooks.rulesCount': { ru: 'Правил: {n}', en: 'Rules: {n}' },
  'playbooks.rulesMore': { ru: 'ещё {n}', en: '{n} more' },
  'playbooks.save': { ru: 'Сохранить', en: 'Save' },
  'playbooks.delete': { ru: 'Удалить', en: 'Delete' },
  'playbooks.deleteConfirm': { ru: 'Удалить этот плейбук?', en: 'Delete this playbook?' },
  'playbooks.createdToast': { ru: 'Плейбук создан.', en: 'Playbook created.' },
  'playbooks.savedToast': { ru: 'Плейбук сохранён.', en: 'Playbook saved.' },
  'playbooks.deletedToast': { ru: 'Плейбук удалён.', en: 'Playbook deleted.' },
  'playbooks.needName': { ru: 'Введите название.', en: 'Enter a name.' },
  'playbooks.needRule': { ru: 'Добавьте хотя бы одно правило.', en: 'Add at least one rule.' },
  'playbooks.empty': { ru: 'Пока нет плейбуков', en: 'No playbooks yet' },
  'playbooks.emptyBody': {
    ru: 'Создайте первый плейбук со стандартными позициями команды.',
    en: 'Create your first playbook with your team’s standard positions.',
  },
  'playbooks.upsellTitle': { ru: 'Плейбуки — на тарифе Pro', en: 'Playbooks are a Pro feature' },
  'playbooks.upsellBody': {
    ru: 'Перейдите на Pro, чтобы задавать стандартные позиции команды и автоматически находить отклонения в договорах.',
    en: 'Upgrade to Pro to define your team’s standard positions and automatically flag deviations in contracts.',
  },
  'playbooks.upsellCta': { ru: 'Перейти на Pro', en: 'Upgrade to Pro' },
  'playbooks.deviationBadge': { ru: 'Отклонение от плейбука', en: 'Playbook deviation' },

  // Contracts (CLM) — expiry dates, auto-renewals and obligations register
  'contracts.title': { ru: 'Контракты', en: 'Contracts' },
  'contracts.sub': {
    ru: 'Сроки, автопродления и обязательства по проанализированным договорам.',
    en: 'Key dates, auto-renewals and obligations across your analysed contracts.',
  },
  'contracts.exp30': { ru: 'Истекают ≤30 дней', en: 'Expiring ≤30 days' },
  'contracts.exp90': { ru: 'Истекают ≤90 дней', en: 'Expiring ≤90 days' },
  'contracts.autoRenewals': { ru: 'Автопродления', en: 'Auto-renewals' },
  'contracts.openObligations': { ru: 'Обязательства в работе', en: 'Open obligations' },
  'contracts.fAll': { ru: 'Все', en: 'All' },
  'contracts.f30': { ru: '≤30 дней', en: '≤30 days' },
  'contracts.f60': { ru: '≤60 дней', en: '≤60 days' },
  'contracts.f90': { ru: '≤90 дней', en: '≤90 days' },
  'contracts.fAuto': { ru: 'Автопродление', en: 'Auto-renewal' },
  'contracts.fObl': { ru: 'С обязательствами', en: 'With obligations' },
  'contracts.col.contract': { ru: 'Договор', en: 'Contract' },
  'contracts.col.expiry': { ru: 'Окончание', en: 'Expiry' },
  'contracts.col.auto': { ru: 'Автопродление', en: 'Auto-renewal' },
  'contracts.col.value': { ru: 'Сумма', en: 'Value' },
  'contracts.col.law': { ru: 'Право', en: 'Governing law' },
  'contracts.col.obligations': { ru: 'Обязательства', en: 'Obligations' },
  'contracts.autoBadge': { ru: 'Авто', en: 'Auto' },
  'contracts.noticeDays': { ru: 'уведомление за {n} дн.', en: '{n}-day notice' },
  'contracts.daysLeft': { ru: '{n} дн.', en: '{n} days' },
  'contracts.expired': { ru: 'Истёк', en: 'Expired' },
  'contracts.due': { ru: 'срок {date}', en: 'due {date}' },
  'contracts.overdue': { ru: 'Просрочено', en: 'Overdue' },
  'contracts.noneMatch': { ru: 'Под этот фильтр ничего не попадает.', en: 'Nothing matches this filter.' },
  'contracts.empty': { ru: 'Пока нет договоров с извлечёнными сроками', en: 'No contracts with extracted terms yet' },
  'contracts.emptyBody': {
    ru: 'Загрузите договор на анализ — сроки и обязательства появятся здесь автоматически.',
    en: 'Upload a contract for analysis — its key dates and obligations will appear here automatically.',
  },
  'contracts.emptyCta': { ru: 'Загрузить договор', en: 'Upload a contract' },
  'contracts.upsellTitle': { ru: 'Контроль сроков — на тарифе Pro', en: 'Contract lifecycle is a Pro feature' },
  'contracts.upsellBody': {
    ru: 'Доступно на планах Pro и Business: окончания, автопродления и обязательства по всем договорам в одном реестре.',
    en: 'Available on Pro and Business plans: expiry dates, auto-renewals and obligations across all your contracts in one register.',
  },
  'contracts.upsellCta': { ru: 'Перейти на Pro', en: 'Upgrade to Pro' },
  'contracts.termsTitle': { ru: 'Сроки и обязательства', en: 'Key dates & obligations' },
  'contracts.effective': { ru: 'Начало действия', en: 'Effective date' },
  'contracts.showObligations': { ru: 'Показать обязательства', en: 'Show obligations' },

  // Batch review
  'batch.title': { ru: 'Массовый разбор', en: 'Batch review' },
  'batch.sub': {
    ru: 'Загрузите пачку договоров — Lexab проанализирует их вместе и покажет риск по каждому.',
    en: 'Upload a pack of contracts — Lexab analyses them together and shows the risk of each.',
  },
  'batch.upsellTitle': { ru: 'Массовый разбор — на тарифе Pro', en: 'Batch review is a Pro feature' },
  'batch.upsellBody': {
    ru: 'Доступно на планах Pro и Business: загрузите до 20 договоров разом и получите анализ по каждому в одной очереди.',
    en: 'Available on Pro and Business plans: upload up to 20 contracts at once and get an analysis of each in a single queue.',
  },
  'batch.upsellCta': { ru: 'Перейти на Pro', en: 'Upgrade to Pro' },
  'batch.dropHint': { ru: 'Перетащите файлы сюда или нажмите, чтобы выбрать', en: 'Drop files here or click to choose' },
  'batch.maxHint': { ru: 'PDF, Word, TXT или Markdown — до 20 файлов за раз', en: 'PDF, Word, TXT or Markdown — up to 20 files at a time' },
  'batch.maxReached': { ru: 'Можно добавить не больше 20 файлов.', en: 'You can add at most 20 files.' },
  'batch.pick': { ru: 'Выбрать файлы', en: 'Choose files' },
  'batch.remove': { ru: 'Убрать файл', en: 'Remove file' },
  'batch.uploading': { ru: 'загрузка…', en: 'uploading…' },
  'batch.submitting': { ru: 'Запуск…', en: 'Starting…' },
  'batch.start': { ru: 'Начать разбор', en: 'Start review' },
  'batch.newBatch': { ru: 'Новый разбор', en: 'New review' },
  'batch.noneUploaded': { ru: 'Не удалось загрузить ни один файл.', en: 'No files could be uploaded.' },
  'batch.someFailed': {
    ru: 'Файлов не загрузилось: {n}. Они остались в списке с причиной',
    en: '{n} file(s) failed to upload. They stay in the list with the reason.',
  },
  'batch.jurisdiction': { ru: 'Юрисдикция', en: 'Jurisdiction' },
  'batch.progress': { ru: 'Обработано {done} из {total}', en: '{done} of {total} processed' },
  'batch.failedCount': { ru: 'ошибок: {n}', en: '{n} failed' },
  'batch.jobDone': { ru: 'Разбор завершён', en: 'Review complete' },
  'batch.status.queued': { ru: 'В очереди', en: 'Queued' },
  'batch.status.processing': { ru: 'Обработка', en: 'Processing' },
  'batch.status.done': { ru: 'Готово', en: 'Done' },
  'batch.status.error': { ru: 'Ошибка', en: 'Error' },
  'batch.col.file': { ru: 'Файл', en: 'File' },
  'batch.col.status': { ru: 'Статус', en: 'Status' },
  'batch.col.risk': { ru: 'Риск', en: 'Risk' },
  'batch.col.findings': { ru: 'Находки', en: 'Findings' },
  'batch.col.job': { ru: 'Разбор', en: 'Review' },
  'batch.col.result': { ru: 'Результат', en: 'Result' },
  'batch.col.created': { ru: 'Создан', en: 'Created' },
  'batch.history': { ru: 'История разборов', en: 'Review history' },
  'batch.noHistory': { ru: 'Пока нет разборов — загрузите первую пачку договоров.', en: 'No reviews yet — upload your first pack of contracts.' },
  'batch.jobLabel': { ru: 'Договоров: {n}', en: '{n} contracts' },
  'batch.summary': { ru: 'готово {done} из {total}', en: '{done} of {total} done' },

  // Chat · analysis progress card
  'chat.an.workingTitle': { ru: 'Анализирую контракт', en: 'Analyzing contract' },
  'chat.an.doneTitle': { ru: 'Анализ завершён', en: 'Analysis complete' },
  'chat.an.badgeWork': { ru: 'В работе', en: 'Working' },
  'chat.an.badgeDone': { ru: 'Готово', en: 'Complete' },
  'chat.an.step1': { ru: 'Разбираю структуру документа', en: 'Parsing document structure' },
  // Судебной практики в корпусе НЕТ (только статуты) — обещать её нельзя
  // (аудит 2026-08-03). Вернуть упоминание, когда заработает загрузчик
  // caselaw.nationalarchives.gov.uk.
  'chat.an.step2': { ru: 'Сверяю с базой законов', en: 'Checking against the statute corpus' },
  'chat.an.step3': { ru: 'Формирую отчёт о рисках', en: 'Building risk report' },

  // Chat · summary card
  'chat.sum.meta': { ru: 'Находок: {n} · проверено пунктов: {m}', en: 'Findings: {n} · Clauses reviewed: {m}' },
  'chat.sum.top': { ru: 'Топ-{n} находок', en: 'Top {n} findings' },
  'chat.sum.followUp': { ru: 'Задать вопрос', en: 'Ask a follow-up' },
  'chat.thinking': { ru: 'Lexab думает…', en: 'Lexab is thinking…' },
  'chat.retryNeedsFile': {
    ru: 'Файл недоступен после перезагрузки — прикрепите его заново',
    en: 'The file is no longer available — please attach it again.',
  },
  'chat.loadFailed': {
    ru: 'Не удалось загрузить чат. Проверьте соединение и попробуйте ещё раз',
    en: "Couldn't load this chat. Check your connection and try again.",
  },

  // Chat · message actions (below assistant replies)
  'chat.act.like': { ru: 'Хороший ответ', en: 'Good response' },
  'chat.act.dislike': { ru: 'Плохой ответ', en: 'Bad response' },
  'chat.act.copy': { ru: 'Копировать', en: 'Copy' },
  'chat.act.copied': { ru: 'Скопировано', en: 'Copied' },
  'chat.act.more': { ru: 'Ещё', en: 'More' },
  'chat.act.speak': { ru: 'Прочитать вслух', en: 'Read aloud' },
  'chat.act.speakStop': { ru: 'Остановить чтение', en: 'Stop reading' },
  'chat.act.speakError': { ru: 'Не удалось озвучить. Попробуйте позже.', en: 'Could not play the audio. Try again later.' },
  'chat.act.download': { ru: 'Скачать с оформлением', en: 'Download formatted' },
  'chat.act.thanks': { ru: 'Спасибо за отзыв', en: 'Thanks for the feedback' },

  // Chat · ghost (incognito) mode
  'ghost.enter': { ru: 'Режим призрака', en: 'Ghost mode' },
  'ghost.warnTitle': { ru: 'Включить режим призрака?', en: 'Turn on ghost mode?' },
  'ghost.warnBody': {
    ru: 'Сообщения в этом режиме не сохраняются: закроете чат — переписка исчезнет. Лимиты тарифа и модель ИИ работают как обычно.',
    en: 'Messages in this mode are not saved: close the chat and the conversation is gone. Plan limits and your AI model work as usual.',
  },
  'ghost.warnConfirm': { ru: 'Включить', en: 'Turn on' },
  'ghost.warnCancel': { ru: 'Отмена', en: 'Cancel' },
  'ghost.active': { ru: 'Режим призрака — сообщения не сохраняются', en: 'Ghost mode — messages are not saved' },
  'ghost.exit': { ru: 'Выйти', en: 'Exit' },
  'ghost.left': { ru: 'Режим призрака выключен', en: 'Ghost mode is off' },
  'ghost.noFiles': { ru: 'В режиме призрака файлы недоступны', en: 'Files are unavailable in ghost mode' },

  // Chat · Free-plan upgrade nudge above the composer
  'chat.upsell.title': { ru: 'Больше возможностей с Lexab', en: 'Get more with Lexab' },
  'chat.upsell.cta': { ru: 'Улучшить', en: 'Upgrade' },
  'chat.limitReached': {
    ru: 'Лимит ИИ-запросов вашего тарифа на этот месяц исчерпан. Чтобы продолжить, обновите тариф в разделе «Тарифы».',
    en: 'Your plan’s monthly AI request limit is used up. Upgrade your plan on the Plans page to continue.',
  },
  'chat.error': {
    ru: 'Не удалось получить ответ ИИ. Попробуйте ещё раз чуть позже.',
    en: 'Couldn’t get an AI reply. Please try again in a moment.',
  },

  // Chat · offline fallback replies (no AI connection)
  'chat.mock.draft': {
    ru: 'Готовлю черновик. Вот структура двустороннего NDA (право Великобритании): 1) Стороны и определения; 2) Конфиденциальная информация; 3) Обязательства получателя; 4) Исключения; 5) Срок и возврат; 6) Средства правовой защиты; 7) Применимое право. Скажите, какие пункты уточнить.',
    en: 'Drafting. Here is the structure of a mutual NDA (UK law): 1) Parties and definitions; 2) Confidential information; 3) Recipient obligations; 4) Exclusions; 5) Term and return; 6) Remedies; 7) Governing law. Tell me which clauses to refine.',
  },
  'chat.mock.compare': {
    ru: 'Сравнение версий: обнаружено 6 изменённых пунктов. Ключевые: срок уведомления о расторжении сокращён с 3 месяцев до 1; добавлена оговорка о неконкуренции (12 мес.); изменён порядок разрешения споров на арбитраж LCIA. Открыть детальный дифф?',
    en: 'Version compare: 6 changed clauses found. Key ones: termination notice cut from 3 months to 1; a non-compete clause added (12 months); dispute resolution switched to LCIA arbitration. Open the detailed diff?',
  },
  'chat.mock.translate': {
    ru: 'Готов перевести и локализовать текст. Укажите целевой язык и юрисдикцию — я адаптирую терминологию и ссылки на нормы под местное право.',
    en: 'Ready to translate and localise the text. Name the target language and jurisdiction — I will adapt the terminology and statutory references to local law.',
  },
  'chat.mock.default': {
    ru: 'Принял. Уточните детали контракта или пункта — и я подготовлю ответ со ссылками на применимые нормы. Для полного обзора рисков загрузите документ или используйте /analyze.',
    en: 'Got it. Share the contract or clause details and I will prepare an answer with references to the applicable rules. For a full risk review upload a document or use /analyze.',
  },

  // Network status
  'net.lost': { ru: 'Соединение потеряно — работаем офлайн.', en: 'Connection lost — working offline.' },
  'net.back': { ru: 'Соединение восстановлено.', en: 'Connection restored.' },
  'net.offline': { ru: 'Нет подключения к интернету.', en: 'No internet connection.' },

  // Team · organisation name
  'team.orgPh': { ru: 'Название организации (например, ООО «Ромашка»)', en: 'Organisation name (e.g. Acme Inc.)' },
  'team.orgSave': { ru: 'Сохранить название', en: 'Save name' },
  'team.orgSaved': { ru: 'Название организации сохранено.', en: 'Organisation name saved.' },
  'team.orgEdit': { ru: 'Изменить', en: 'Edit' },
  'team.orgHint': {
    ru: 'Название увидит вся команда в Настройках.',
    en: 'The whole team will see this name in Settings.',
  },
  'settings.orgLocked': {
    ru: 'Название организации задаёт владелец команды или админ — здесь его изменить нельзя',
    en: 'The organisation name is managed by the team owner or an admin — it cannot be changed here',
  },

  // Job titles (approval steps + team invites)
  'roles.placeholder': { ru: 'Выберите должность…', en: 'Pick a role…' },
  'roles.editor': { ru: 'Редактор', en: 'Editor' },
  'roles.lawyer': { ru: 'Юрист', en: 'Lawyer' },
  'roles.admin': { ru: 'Админ', en: 'Admin' },
  'roles.owner': { ru: 'Владелец', en: 'Owner' },
  'roles.viewer': { ru: 'Наблюдатель', en: 'Viewer' },
  'roles.custom': { ru: 'Другая должность…', en: 'Other role…' },
  'roles.customPh': { ru: 'Введите должность', en: 'Type the role' },

  // Integrations (Settings) + cloud import (chat)
  'integr.title': { ru: 'Интеграции', en: 'Integrations' },
  'integr.sub': {
    ru: 'Подключите облачные хранилища и загружайте договоры прямо оттуда.',
    en: 'Connect your cloud drives and pull contracts straight from them.',
  },
  'integr.statusConnected': { ru: 'Подключено', en: 'Connected' },
  'integr.statusOff': { ru: 'Не подключено', en: 'Not connected' },
  'integr.statusSoon': { ru: 'Скоро — идёт настройка', en: 'Coming soon — being set up' },
  'integr.connect': { ru: 'Подключить', en: 'Connect' },
  'integr.disconnect': { ru: 'Отключить', en: 'Disconnect' },
  'integr.connected': { ru: 'Интеграция подключена', en: 'Integration connected' },
  'integr.connectFailed': { ru: 'Не получилось подключить — попробуйте ещё раз', en: 'Connection failed — please try again' },
  'integr.disconnected': { ru: 'Интеграция отключена', en: 'Integration disconnected' },
  'integr.hint': {
    ru: 'Импорт файлов — в чате: кнопка облака рядом со скрепкой.',
    en: 'Import files from the chat: the cloud button next to the paperclip.',
  },
  'cloud.title': { ru: 'Импорт из облака', en: 'Import from cloud' },
  'cloud.noneConnected': {
    ru: 'Облачные хранилища ещё не подключены. Подключите Google Drive, Microsoft 365 или Dropbox в Настройках.',
    en: 'No cloud drives connected yet. Connect Google Drive, Microsoft 365 or Dropbox in Settings.',
  },
  'cloud.goSettings': { ru: 'Открыть настройки', en: 'Open Settings' },
  'cloud.drivePick': { ru: 'Выбрать файл на Google Диске', en: 'Pick a file from Google Drive' },
  'cloud.search': { ru: 'Поиск по названию…', en: 'Search by name…' },
  'cloud.empty': { ru: 'Подходящих файлов не найдено (PDF, DOC, DOCX, TXT, MD)', en: 'No matching files found (PDF, DOC, DOCX, TXT, MD)' },
  'cloud.importing': { ru: 'Импортирую…', en: 'Importing…' },

  // Plan / subscription

  // Chat welcome
  'chat.greeting.morning': { ru: 'Доброе утро', en: 'Good morning' },
  'chat.greeting.afternoon': { ru: 'Добрый день', en: 'Good afternoon' },
  'chat.greeting.evening': { ru: 'Добрый вечер', en: 'Good evening' },
  'chat.welcome.sub': {
    ru: 'Загрузите контракт, чтобы начать обзор, или начните с команды.',
    en: 'Drop a contract to begin your review, or start with a command.',
  },
  'chat.suggest.analyze.title': { ru: 'Анализ контракта', en: 'Analyze a contract' },
  'chat.suggest.analyze.body': { ru: 'Загрузите для полного обзора рисков', en: 'Upload for a full risk review' },
  'chat.suggest.draft.title': { ru: 'Составить NDA', en: 'Draft an NDA' },
  'chat.suggest.draft.body': { ru: 'Двусторонний, по праву {country}', en: 'Mutual, governed by the law of {country}' },
  // Country names as used inside "governed by the law of …" phrases (the
  // Russian genitive lives in COUNTRIES.nameGen; en keeps required articles).
  'country.US': { ru: 'США', en: 'the United States' },
  'country.GB': { ru: 'Великобритания', en: 'the United Kingdom' },
  'country.DE': { ru: 'Германия', en: 'Germany' },
  'country.CA': { ru: 'Канада', en: 'Canada' },
  'country.KZ': { ru: 'Казахстан', en: 'Kazakhstan' },
  'country.UZ': { ru: 'Узбекистан', en: 'Uzbekistan' },
  'country.AE': { ru: 'ОАЭ', en: 'the UAE' },
  'chat.draft.title': { ru: 'Создать договор', en: 'Create a contract' },
  'chat.draft.placeholder': {
    ru: 'Опишите нужный договор: тип, стороны, срок, ключевые условия…',
    en: 'Describe the contract you need: type, parties, term, key terms…',
  },
  'chat.draft.hint': {
    ru: 'ИИ составит договор и откроет его на листе — там его можно править вручную, проверять и скачивать.',
    en: 'The AI drafts the contract and opens it as a sheet — edit it by hand, review, and download.',
  },
  'chat.draft.generate': { ru: 'Создать', en: 'Create' },
  'cloud.linkPh': { ru: 'Или вставьте ссылку на файл Google Drive…', en: 'Or paste a Google Drive file link…' },
  'cloud.linkImport': { ru: 'Импорт', en: 'Import' },
  'cloud.linkHint': {
    ru: 'Работает без сторонних cookies: откройте файлу доступ «Все, у кого есть ссылка» и вставьте её сюда.',
    en: 'Works without third-party cookies: set the file to “Anyone with the link” and paste the link here.',
  },
  'chat.expand': { ru: 'Развернуть', en: 'Expand' },
  'chat.collapse': { ru: 'Свернуть', en: 'Collapse' },
  'chat.ask.explain': {
    ru: 'Объясни находку «{title}» — чем это грозит и что делать?',
    en: 'Explain the finding “{title}” — what is the risk and what should I do?',
  },
  'chat.ask.fix': {
    ru: 'Как безопасно переформулировать самые рискованные пункты?',
    en: 'How do I safely rewrite the riskiest clauses?',
  },
  'chat.ask.next': {
    ru: 'Какие шаги предпринять в первую очередь по итогам анализа?',
    en: 'What should I do first based on this analysis?',
  },
  'chat.ask.other': { ru: 'Другое — задам свой вопрос…', en: 'Other — I’ll type my own question…' },
  'chat.draft.generating': { ru: 'Составляю договор…', en: 'Drafting the contract…' },
  'chat.suggest.compare.title': { ru: 'Сравнить версии', en: 'Compare versions' },
  'chat.suggest.compare.body': { ru: 'Различия двух черновиков по пунктам', en: 'Diff two drafts clause by clause' },
  'chat.input.placeholder': { ru: 'Спросите Lexab…', en: 'Ask Lexab…' },
  'chat.disclaimer': {
    ru: 'Lexab может ошибаться. Проверяйте ссылки по первоисточникам.',
    en: 'Lexab can make mistakes. Verify citations against primary sources.',
  },
  'chat.dropHere': { ru: 'Отпустите файл, чтобы загрузить', en: 'Drop the file to upload' },

  // Commands
  'cmd.analyze': { ru: 'Обзор контракта на юридические риски', en: 'Review a contract for legal risk' },
  'cmd.draft': { ru: 'Сгенерировать пункт или документ', en: 'Generate a clause or full document' },
  'cmd.compare': { ru: 'Сравнить две версии контракта', en: 'Diff two contract versions' },
  'cmd.translate': { ru: 'Перевести и локализовать текст', en: 'Translate & localise legal text' },
  'cmd.section': { ru: 'Команды', en: 'Commands' },

  // Compare
  'cmp.title': { ru: 'Сравнение версий', en: 'Compare versions' },
  'cmp.sub': { ru: 'Различия между двумя версиями договора по пунктам.', en: 'Differences between two contract versions, clause by clause.' },
  'cmp.changes': { ru: 'Изменённых пунктов: {n}', en: 'Changed clauses: {n}' },

  // Analysis
  'analysis.openWorkspace': { ru: 'Открыть рабочую область', en: 'Open workspace' },
  'risk.Low': { ru: 'Низкий риск', en: 'Low risk' },
  'risk.Elevated': { ru: 'Повышенный риск', en: 'Elevated risk' },
  'risk.High': { ru: 'Высокий риск', en: 'High risk' },

  // Generic
  'common.loading': { ru: 'Загрузка…', en: 'Loading…' },
  'common.cancel': { ru: 'Отмена', en: 'Cancel' },
  'common.save': { ru: 'Сохранить', en: 'Save' },
  'common.error': { ru: 'Что-то пошло не так', en: 'Something went wrong' },
  'common.close': { ru: 'Закрыть', en: 'Close' },
  'common.back': { ru: 'Назад', en: 'Back' },

  // Documents
  'docs.title': { ru: 'Документы', en: 'Documents' },
  'docs.sub': { ru: 'Все загруженные, проверенные и подписанные контракты.', en: 'Every contract you’ve uploaded, analysed, or signed.' },
  'docs.search': { ru: 'Поиск по названию или контрагенту…', en: 'Search by name or counterparty…' },
  'docs.allStatuses': { ru: 'Все статусы', en: 'All statuses' },
  'docs.allRisk': { ru: 'Все уровни риска', en: 'All risk levels' },
  'docs.col.document': { ru: 'Документ', en: 'Document' },
  'docs.col.status': { ru: 'Статус', en: 'Status' },
  'docs.col.risk': { ru: 'Риск', en: 'Risk' },
  'docs.col.jurisdiction': { ru: 'Юрисдикция', en: 'Jurisdiction' },
  'docs.col.updated': { ru: 'Обновлён', en: 'Updated' },
  'docs.empty': { ru: 'Документы не найдены', en: 'No documents found' },
  'docs.emptyBody': { ru: 'Измените запрос или загрузите контракт из чата.', en: 'Try a different search, or upload a contract from the chat.' },
  'docs.today': { ru: 'Сегодня', en: 'Today' },
  'docs.yesterday': { ru: 'Вчера', en: 'Yesterday' },
  'docs.daysAgo': { ru: '{n} дн. назад', en: '{n} days ago' },
  'docs.prev': { ru: 'Назад', en: 'Prev' },
  'docs.next': { ru: 'Далее', en: 'Next' },
  'docs.pageOf': { ru: 'Стр. {page} из {total}', en: 'Page {page} of {total}' },
  'docs.count': { ru: 'Документов: {n}', en: 'Documents: {n}' },

  // Auth
  'auth.signInTitle': { ru: 'Вход в Lexab', en: 'Sign in to Lexab' },
  'auth.signUpTitle': { ru: 'Создать аккаунт', en: 'Create your account' },
  'auth.email': { ru: 'Email', en: 'Email' },
  'auth.password': { ru: 'Пароль', en: 'Password' },
  'auth.name': { ru: 'Имя', en: 'Full name' },
  'auth.signIn': { ru: 'Войти', en: 'Sign in' },
  'auth.signUp': { ru: 'Зарегистрироваться', en: 'Sign up' },
  'auth.toSignUp': { ru: 'Нет аккаунта? Создать', en: 'No account? Sign up' },
  'auth.toSignIn': { ru: 'Уже есть аккаунт? Войти', en: 'Have an account? Sign in' },
  'auth.signOut': { ru: 'Выйти', en: 'Sign out' },
  'auth.errRequired': { ru: 'Заполните все поля.', en: 'All fields are required.' },
  'auth.errEmail': { ru: 'Введите корректный email.', en: 'Enter a valid email address.' },
  'auth.errPassword': { ru: 'Пароль минимум 8 символов.', en: 'Password must be at least 8 characters.' },
  'auth.tagline': { ru: 'Интеллектуальный анализ контрактов', en: 'AI contract intelligence' },
  'auth.forgot': { ru: 'Забыли пароль?', en: 'Forgot password?' },
  'auth.resetTitle': { ru: 'Сброс пароля', en: 'Reset password' },
  'auth.resetHint': { ru: 'Укажите email — пришлём ссылку для сброса пароля.', en: "Enter your email — we'll send a reset link." },
  'auth.resetSend': { ru: 'Отправить ссылку', en: 'Send reset link' },
  'auth.resetSent': { ru: 'Если такой аккаунт существует — письмо со ссылкой уже в пути.', en: 'If that account exists, a reset link is on its way.' },
  'auth.verifySentA': { ru: 'Аккаунт создан! Мы отправили письмо на ', en: "Account created! We've sent a link to " },
  'auth.verifySentB': {
    ru: ' — перейдите по ссылке из письма, чтобы подтвердить адрес и войти.',
    en: ' — click the link in the letter to confirm your address and sign in.',
  },
  'auth.backToSignIn': { ru: '← Назад ко входу', en: '← Back to sign in' },
  'auth.heroLine1': { ru: 'Анализируй контракты', en: 'Review contracts' },
  'auth.heroLine2': { ru: 'быстрее', en: 'faster' },
  'auth.heroSub': {
    ru: 'Lexab находит риски, готовит правки и отвечает на вопросы по документам — за минуты, а не часы.',
    en: 'Lexab finds risks, drafts redlines and answers questions about your documents — in minutes, not hours.',
  },
  'auth.google': { ru: 'Продолжить с Google', en: 'Continue with Google' },
  'auth.or': { ru: 'ИЛИ', en: 'OR' },
  'auth.emailContinue': { ru: 'Продолжить по email', en: 'Continue with email' },
  'auth.googleFailed': { ru: 'Не удалось войти через Google. Попробуйте ещё раз.', en: 'Google sign-in failed. Please try again.' },
  'auth.sessionExpired': { ru: 'Сессия истекла — войдите снова.', en: 'Your session expired — please sign in again.' },
  'auth.ssoButton': { ru: 'Войти через SSO', en: 'Sign in with SSO' },
  'auth.ssoEmailLabel': { ru: 'Рабочая почта', en: 'Work email' },
  'auth.ssoContinue': { ru: 'Продолжить', en: 'Continue' },
  'auth.ssoBadEmail': { ru: 'Введите корректную рабочую почту.', en: 'Enter a valid work email.' },
  'auth.ssoNotConfigured': { ru: 'Для этого домена SSO не настроен.', en: 'SSO is not configured for this domain.' },
  'auth.ssoRequired': { ru: 'Ваша организация требует вход через SSO.', en: 'Your organisation requires SSO sign-in.' },
  'auth.ssoTeamFull': { ru: 'В команде нет свободных мест — обратитесь к администратору.', en: 'No free team seats — contact your administrator.' },
  'auth.ssoDomainMismatch': { ru: 'Домен почты не совпадает с доменом организации.', en: 'Email domain does not match the organisation domain.' },
  'auth.signingIn': { ru: 'Входим в Lexab…', en: 'Signing you in…' },
  // Honest, measured trust signals (RAG eval, golden set — see HANDOFF.md).
  'auth.metricWithoutLabel': {
    ru: 'точность ссылок на закон у ИИ без базы законов',
    en: 'legal-citation accuracy of plain AI, no law corpus',
  },
  'auth.metricWithLabel': {
    ru: 'с проверкой по базе официальных текстов',
    en: 'with verification against official texts',
  },
  'auth.metricNote': {
    ru: 'Замер на тестовом наборе вопросов · право Узбекистана',
    en: 'Measured on our golden test set · Uzbekistan law',
  },
  'auth.badgeVerified': { ru: 'Каждая цитата проверяется автоматически', en: 'Every citation is checked automatically' },
  'auth.badgeSources': { ru: 'Только официальные источники законов', en: 'Official law sources only' },
  'auth.badgeAI': { ru: 'ИИ-модели последнего поколения', en: 'Latest-generation AI models' },

  // Landing (public /login page)
  'lang.switch': { ru: 'Язык интерфейса', en: 'Interface language' },
  'landing.nav.aria': { ru: 'Разделы страницы', en: 'Page sections' },
  'landing.nav.features': { ru: 'Возможности', en: 'Features' },
  'landing.nav.solutions': { ru: 'Для кого', en: 'Who it’s for' },
  'landing.nav.security': { ru: 'Безопасность', en: 'Security' },
  'landing.nav.plans': { ru: 'Тарифы', en: 'Pricing' },
  'landing.nav.faq': { ru: 'FAQ', en: 'FAQ' },
  'landing.howItWorks': { ru: 'Как это работает', en: 'How it works' },
  'landing.viewDemo': { ru: 'Посмотреть демо', en: 'View demo' },
  'landing.startFree': { ru: 'Попробовать бесплатно', en: 'Try for free' },
  'landing.navCta': { ru: 'Начать бесплатно', en: 'Start free' },
  'landing.choosePlan': { ru: 'Выбрать план', en: 'Choose plan' },
  'landing.toTop': { ru: 'Наверх', en: 'Back to top' },
  'landing.tg.title': { ru: 'Свяжитесь с нами в Telegram', en: 'Contact us on Telegram' },
  'landing.wa.title': { ru: 'Свяжитесь с нами в WhatsApp', en: 'Contact us on WhatsApp' },
  'landing.tg.scan': { ru: 'Наведите камеру на QR-код', en: 'Scan the QR code with your camera' },

  // Settings
  'settings.title': { ru: 'Настройки', en: 'Settings' },
  'settings.sub': { ru: 'Управляйте профилем и внешним видом Lexab.', en: 'Manage your profile and how Lexab looks.' },
  'settings.plan': { ru: 'Подписка и лимиты', en: 'Plan & limits' },
  'settings.planSub': { ru: 'Ваш тариф и использование за текущий месяц.', en: 'Your plan and this month’s usage.' },
  'settings.changePlan': { ru: 'Изменить план', en: 'Change plan' },
  'settings.managePayment': { ru: 'Оплата и чеки', en: 'Manage billing' },
  'settings.subActiveUntil': { ru: 'Активна, продление {date}', en: 'Active, renews {date}' },
  'settings.subCancel': { ru: 'Отменить подписку', en: 'Cancel subscription' },
  'settings.subCancelConfirm': { ru: 'Доступ сохранится до конца оплаченного периода; деньги за начатый период не возвращаются.', en: 'Access stays until the end of the paid period; the started period is non-refundable.' },
  'settings.subCancelDo': { ru: 'Отменить', en: 'Cancel it' },
  'settings.subCancelled': { ru: 'Подписка будет отменена в конце периода.', en: 'Subscription will end at the period’s end.' },
  'settings.subCancelScheduled': { ru: 'Отмена запланирована — доступ до {date}', en: 'Cancellation scheduled — access until {date}' },
  'settings.subResume': { ru: 'Возобновить', en: 'Resume' },
  'settings.subResumed': { ru: 'Подписка возобновлена.', en: 'Subscription resumed.' },
  'settings.subPastDue': { ru: 'Проблема с оплатой — доступ сохранится до {date}', en: 'Payment issue — access kept until {date}' },
  'limits.ai': { ru: 'AI-запросы в месяц', en: 'AI requests this month' },
  'limits.docs': { ru: 'Документы в месяц', en: 'Documents this month' },
  'limits.storage': { ru: 'Хранилище', en: 'Storage' },
  'limits.unlimited': { ru: 'Безлимит', en: 'Unlimited' },
  'settings.profile': { ru: 'Профиль', en: 'Profile' },
  'settings.avatarUpload': { ru: 'Загрузить фото', en: 'Upload photo' },
  'settings.avatarRemove': { ru: 'Удалить', en: 'Remove' },
  'settings.avatarHint': { ru: 'PNG или JPG, до 2 МБ.', en: 'PNG or JPG, up to 2 MB.' },
  'settings.language': { ru: 'Язык', en: 'Language' },

  // Command palette
  'palette.placeholder': { ru: 'Куда перейти или что сделать…', en: 'Go to or do anything…' },
  'palette.nav': { ru: 'Навигация', en: 'Navigation' },
  'palette.actions': { ru: 'Действия', en: 'Actions' },
  'palette.action.newReview': { ru: 'Новый обзор', en: 'New review' },
  'palette.action.toggleTheme': { ru: 'Переключить тему', en: 'Toggle theme' },
  'palette.action.upgrade': { ru: 'Открыть тарифы', en: 'Open plans' },

  // Document / signature statuses and risk levels
  'status.Draft': { ru: 'Черновик', en: 'Draft' },
  'status.In review': { ru: 'На проверке', en: 'In review' },
  'status.Reviewed': { ru: 'Проверен', en: 'Reviewed' },
  'status.Signed': { ru: 'Подписан', en: 'Signed' },
  'sigstatus.Draft': { ru: 'Черновик', en: 'Draft' },
  'sigstatus.Sent': { ru: 'Отправлен', en: 'Sent' },
  'sigstatus.Viewed': { ru: 'Просмотрен', en: 'Viewed' },
  'sigstatus.Completed': { ru: 'Завершён', en: 'Completed' },
  'sigstatus.Declined': { ru: 'Отклонён', en: 'Declined' },

  // Chat composer
  'chat.fileTypes': { ru: 'Поддерживаются файлы PDF, DOC/DOCX, TXT.', en: 'Supported files: PDF, DOC/DOCX, TXT.' },
  'chat.fileTooBig': { ru: 'Файл больше 10 МБ — загрузите файл поменьше.', en: 'File exceeds 10 MB — please upload a smaller one.' },
  // Текст прямо противоречил коду: анализ в этом случае НЕ запускается вовсе
  // (загрузка не удалась — конвейер обрывается). Аудит 2026-08-03.
  'chat.an.elapsed': { ru: 'Идёт разбор · {time}', en: 'Reviewing · {time}' },
  'chat.an.sec': { ru: 'с', en: 's' },
  'chat.an.min': { ru: 'мин', en: 'min' },
  'chat.uploadFailed': {
    ru: 'Файл не загрузился — анализ не выполнен. Попробуйте ещё раз.',
    en: "The file didn't upload — no review was run. Please try again.",
  },
  'chat.micDenied': {
    ru: 'Разрешите доступ к микрофону в настройках браузера.',
    en: 'Allow microphone access in your browser settings.',
  },
  'chat.micStart': { ru: 'Голосовой ввод', en: 'Voice input' },
  'chat.micStop': { ru: 'Остановить запись', en: 'Stop recording' },
  'chat.attach': { ru: 'Прикрепить договор', en: 'Attach contract' },
  'chat.sendLabel': { ru: 'Отправить сообщение', en: 'Send message' },
  'chat.improve': { ru: 'Улучшить промпт', en: 'Improve prompt' },
  'chat.improveShort': {
    ru: 'Опишите запрос подробнее — минимум 5 слов',
    en: 'Describe your request in at least 5 words',
  },
  'chat.improveLong': {
    ru: 'Текст слишком длинный для улучшения (до 4000 символов)',
    en: 'Text is too long to improve (up to 4,000 characters)',
  },
  'chat.improveError': {
    ru: 'Не удалось улучшить запрос. Попробуйте ещё раз.',
    en: 'Couldn’t improve the prompt. Please try again.',
  },

  // Workspace
  'ws.review': { ru: 'Обзор', en: 'Review' },
  'ws.backToChat': { ru: 'Назад в чат', en: 'Back to chat' },
  'ws.draftBadge': { ru: 'Черновик шаблона', en: 'Template draft' },
  'ws.draftIntro': {
    ru: 'Это черновик из ваших шаблонов. Текст можно править прямо в документе — изменения сохраняются в шаблон. Нажмите «Анализ рисков ИИ» — я проверю документ и подготовлю правки.',
    en: 'This is a draft from your templates. You can edit the text right in the document — changes are saved back to the template. Press “AI risk analysis” and I will review the document and prepare edits.',
  },
  'ws.analyzeRisks': { ru: 'Анализ рисков ИИ', en: 'AI risk analysis' },
  'ws.analyzingDraft': { ru: 'ИИ анализирует…', en: 'AI is analyzing…' },
  'ws.openChat': { ru: 'Открыть чат', en: 'Open chat' },
  'ws.hideChat': { ru: 'Свернуть чат', en: 'Collapse chat' },
  'ws.dragResize': { ru: 'Потяните, чтобы изменить ширину. Двойной клик — сброс', en: 'Drag to resize. Double-click to reset' },
  'ws.intro': {
    ru: 'Я добавил {n} правок в документ. Примите или отклоните каждую справа — или примените все сразу. Задавайте вопросы по договору ниже.',
    en: 'I placed {n} tracked changes in the document. Accept or reject each on the right — or apply all at once. Ask me anything about this contract below.',
  },
  'ws.allAccepted': { ru: 'Все правки приняты.', en: 'All suggestions accepted.' },
  'ws.acceptAllUndone': { ru: 'Принятие всех правок отменено.', en: 'Accept all undone.' },
  'ws.revertRedline': { ru: 'Вернуть правку в ожидание', en: 'Revert to pending' },
  'ws.jumpToClause': { ru: 'Перейти к пункту договора', en: 'Jump to the clause' },
  'ws.acceptAll': { ru: 'Принять все ({n})', en: 'Accept all ({n})' },
  'ws.reviewedBadge': { ru: 'Проверено', en: 'Reviewed' },
  'ws.allReviewedBadge': { ru: 'Все проверены', en: 'All reviewed' },
  'ws.suggestionsCount': { ru: 'Правок: {n}', en: 'Suggestions: {n}' },
  'ws.downloadDocx': { ru: 'Скачать DOCX', en: 'Download DOCX' },
  'ws.download': { ru: 'Скачать Word', en: 'Download Word' },
  'ws.downloadTracked': { ru: 'С правками (Word Track Changes)', en: 'With tracked changes (Word)' },
  'ws.downloadTrackedHint': { ru: 'Контрагент принимает или отклоняет каждую правку прямо в Word', en: 'The other side accepts or rejects each change in Word' },
  'ws.downloadClean': { ru: 'Чистовик (правки применены)', en: 'Clean copy (changes applied)' },
  'ws.downloadCleanHint': { ru: 'Готовый текст с принятыми правками, без пометок', en: 'Final text with accepted changes, no markup' },
  'ws.sendSign': { ru: 'На e-подпись', en: 'Send for e-signature' },
  'ws.editParagraph': { ru: 'Редактировать абзац', en: 'Edit paragraph' },
  'ws.docxStarted': { ru: 'DOCX загружается…', en: 'DOCX is downloading…' },
  'ws.signSentToast': { ru: 'Запрос на подпись отправлен.', en: 'Signature request sent.' },

  // Country selector
  'country.search': { ru: 'Поиск', en: 'Search' },
  'country.empty': { ru: 'Ничего не найдено', en: 'Nothing found' },

  // Send-for-signature modal
  'sign.title': { ru: 'Отправка на e-подпись', en: 'Send for e-signature' },
  'sign.pageTitle': { ru: 'Подписание документа', en: 'Sign the document' },
  'approve.pageTitle': { ru: 'Согласование документа', en: 'Document approval' },
  // Строки для скринридеров (незрячие пользователи слышат их на языке интерфейса).
  'a11y.closeDialog': { ru: 'Закрыть окно', en: 'Close dialog' },
  'a11y.loading': { ru: 'Загрузка', en: 'Loading' },
  'a11y.messageInput': { ru: 'Сообщение для Lexab', en: 'Message Lexab' },
  'a11y.menu': { ru: 'Меню', en: 'Menu' },
  'a11y.primaryNav': { ru: 'Основная навигация', en: 'Primary navigation' },
  'a11y.documentViewer': { ru: 'Просмотр документа', en: 'Document viewer' },
  'a11y.skipToContent': { ru: 'Перейти к содержимому', en: 'Skip to content' },
  'sign.introA': { ru: 'Получатели получат ', en: 'Recipients will receive ' },
  'sign.introB': { ru: ' с принятыми правками, в порядке подписания.', en: ' with the accepted redlines applied, in signing order.' },
  'sign.namePh': { ru: 'Имя и фамилия', en: 'Full name' },
  'sign.errRequired': { ru: 'Укажите имя и email.', en: 'Name and email are required.' },
  'sign.errEmail': { ru: 'Введите корректный email.', en: 'Enter a valid email address.' },
  'sign.errSend': { ru: 'Не удалось отправить запрос. Попробуйте ещё раз.', en: 'Could not send request. Please try again.' },
  'sign.add': { ru: 'Добавить получателя', en: 'Add recipient' },
  'sign.remove': { ru: 'Убрать получателя', en: 'Remove recipient' },
  'sign.send': { ru: 'Отправить запрос', en: 'Send request' },
  'sign.sending': { ru: 'Отправляю…', en: 'Sending…' },

  // Settings extras
  'settings.profileSub': {
    ru: 'Используется в обзорах, правках и запросах подписи.',
    en: 'Used across reviews, redlines, and signature requests.',
  },
  'settings.saved': { ru: 'Профиль сохранён.', en: 'Profile saved.' },
  'settings.saveFailed': { ru: 'Не удалось сохранить профиль.', en: 'Could not save profile.' },
  'settings.photoFailed': { ru: 'Не удалось сохранить фото.', en: 'Could not save photo.' },
  'settings.photoRemoveFailed': { ru: 'Не удалось удалить фото.', en: 'Could not remove photo.' },
  'settings.jurisdiction': { ru: 'Основная юрисдикция', en: 'Primary jurisdiction' },
  'settings.organisation': { ru: 'Организация', en: 'Organisation' },
  'settings.errName': { ru: 'Укажите имя.', en: 'Name is required.' },

  // Plans page
  'plans.topTitle': { ru: 'Тарифы', en: 'Plans' },
  'plans.title': { ru: 'Тарифы', en: 'Plans' },
  'plans.sub1': { ru: 'Выберите план под ваши юридические задачи.', en: 'Choose the plan that fits your legal workflow.' },
  'plans.sub2': { ru: 'Начните бесплатно и расширяйтесь вместе с командой.', en: 'Start for free and upgrade as your team grows.' },
  'plans.monthly': { ru: 'Месячный', en: 'Monthly' },
  'plans.yearly': { ru: 'Годовой', en: 'Yearly' },
  'plans.periodAria': { ru: 'Период оплаты', en: 'Billing period' },
  'plans.perMonth': { ru: '/ мес', en: '/ mo' },
  'plans.yearlyNote': { ru: 'при оплате за год · экономия 15%', en: 'billed yearly · save 15%' },
  'plans.popular': { ru: 'Популярный', en: 'Popular' },
  'plans.best': { ru: 'Самый выгодный', en: 'Best value' },
  'plans.opening': { ru: 'Открываю…', en: 'Opening…' },
  'plans.checkoutFailed': { ru: 'Не удалось начать оформление. Попробуйте ещё раз.', en: 'Could not start checkout. Please try again.' },
  'plans.consentLabel': { ru: 'Я прошу начать услугу сразу и отказываюсь от 14-дневного права возврата. Оплата за начатый период не возвращается; при отмене доступ сохранится до конца срока.', en: 'I request the service to begin immediately and waive the 14-day right of withdrawal. The started period is non-refundable; on cancellation access stays until the period ends.' },
  'plans.consentRequired': { ru: 'Отметьте согласие, чтобы продолжить.', en: 'Please tick the consent box to continue.' },
  'plans.confirmPurchase': { ru: 'Подтвердить покупку', en: 'Confirm purchase' },
  'plans.freeActive': { ru: 'План Free уже доступен — просто пользуйтесь Lexab.', en: 'The Free plan is already active — just use Lexab.' },

  // Locked email + eye
  'settings.emailLocked': {
    ru: 'Email изменить нельзя — он привязан к аккаунту.',
    en: 'Email cannot be changed — it is tied to your account.',
  },
  'settings.emailShow': { ru: 'Показать email', en: 'Show email' },
  'settings.emailHide': { ru: 'Скрыть email', en: 'Hide email' },

  // Team management
  'team.col.actions': { ru: 'Действия', en: 'Actions' },
  'team.removed': { ru: 'Участник удалён из команды.', en: 'Member removed from the team.' },
  'team.revoked': { ru: 'Приглашение отозвано.', en: 'Invitation revoked.' },
  'team.copyInvite': { ru: 'Скопировать ссылку-приглашение', en: 'Copy invite link' },
  'team.inviteCopied': { ru: 'Ссылка-приглашение скопирована.', en: 'Invite link copied.' },
  'team.remove': { ru: 'Удалить из команды', en: 'Remove from team' },
  'team.revoke': { ru: 'Отозвать приглашение', en: 'Revoke invitation' },
  'auth.inviteNote': {
    ru: 'приглашает вас в команду с ролью {role}. Войдите или зарегистрируйтесь с почтой:',
    en: 'invites you to their team as {role}. Sign in or sign up with:',
  },

  // Shared documents
  'docs.share': { ru: 'Поделиться с командой', en: 'Share with team' },
  'docs.unshare': { ru: 'Убрать из команды', en: 'Unshare from team' },
  'docs.shared': { ru: 'Документ доступен вашей команде.', en: 'The document is now visible to your team.' },
  'docs.unshared': { ru: 'Документ снова личный.', en: 'The document is private again.' },
  'docs.teamBadge': { ru: 'В команде', en: 'Shared' },
  'docs.fromTeam': { ru: 'Команда: {name}', en: 'Team: {name}' },
  'docs.sharedByNote': {
    ru: 'Документ из команды {name}. Ваши права зависят от роли.',
    en: 'Shared by {name}. Your rights depend on your team role.',
  },

  // Document deletion
  'docs.delete': { ru: 'Удалить', en: 'Delete' },
  'docs.deleteTitle': { ru: 'Удалить документ?', en: 'Delete document?' },
  'docs.deleteBody': {
    ru: '«{name}» будет удалён вместе с анализами, версиями и загруженным файлом. Это действие необратимо.',
    en: '“{name}” will be deleted with its analyses, versions and the uploaded file. This cannot be undone.',
  },
  'docs.deleteConfirm': { ru: 'Удалить навсегда', en: 'Delete forever' },
  'docs.deleted': { ru: 'Документ удалён.', en: 'Document deleted.' },

  // Signing links
  'sig.copyLink': { ru: 'Скопировать ссылку для подписи', en: 'Copy signing link' },
  'sig.linkCopied': { ru: 'Ссылка для подписи скопирована.', en: 'Signing link copied.' },
  'sig.copyHint': {
    ru: 'Отправьте получателю ссылку для подписи (кнопка справа) — письмо уйдёт автоматически после подключения почтового сервиса.',
    en: 'Send the recipient their signing link (button on the right) — emails go out automatically once a mail provider is connected.',
  },

  'sig.downloadSigned': { ru: 'Скачать подписанный PDF', en: 'Download signed PDF' },
  'sig.signedPdfStarted': { ru: 'Скачивание подписанного PDF началось.', en: 'Signed PDF download started.' },

  // Public signing page
  'sign.invalidTitle': { ru: 'Ссылка недействительна', en: 'This link is not valid' },
  'sign.doneTitle': { ru: 'Документ подписан', en: 'Document signed' },
  'sign.doneBody': {
    ru: 'Спасибо! Подпись по документу «{doc}» зафиксирована, отправитель получил уведомление.',
    en: 'Thank you! Your signature for “{doc}” has been recorded and the sender has been notified.',
  },
  'sign.requestedBy': { ru: '{name} ({firm}) просит вас подписать этот документ.', en: '{name} ({firm}) asks you to sign this document.' },
  'sign.noPreview': {
    ru: 'Предпросмотр текста недоступен — подтвердите подпись по названию документа.',
    en: 'Text preview is unavailable — confirm your signature for the named document.',
  },
  'sign.yourName': { ru: 'Ваше имя и фамилия', en: 'Your full name' },
  'sign.agree': {
    ru: 'Нажимая «Подписать», вы подтверждаете согласие с содержанием документа. Дата, время и имя будут зафиксированы.',
    en: 'By clicking “Sign” you agree to the contents of this document. Date, time and name will be recorded.',
  },
  'sign.signAction': { ru: 'Подписать', en: 'Sign' },

  // Workspace paper header
  'ws.paperKicker': { ru: 'Документ · проект с правками', en: 'Document · tracked-changes draft' },
  'ws.noAnalysisRedirect': {
    ru: 'Здесь пока нет анализа — загрузите документ в чате.',
    en: 'No review here yet — upload a document in the chat.',
  },
  'ws.readOnly': {
    ru: 'У вас право «только чтение» в этой команде.',
    en: 'Your team role is view-only.',
  },
  'ws.readOnlyBadge': { ru: 'Только чтение', en: 'View only' },
  'chat.attachFirst': {
    ru: 'Прикрепите свой документ кнопкой «+» или перетащите файл в чат.',
    en: 'Attach your document with the “+” button or drag a file into the chat.',
  },
  'plans.contactSent': {
    ru: 'Заявка отправлена — мы свяжемся с вами по email.',
    en: 'Request sent — we will contact you by email.',
  },

  // Approval workflows
  'appr.title': { ru: 'Согласование', en: 'Approval' },
  'appr.start': { ru: 'Отправить на согласование', en: 'Start approval' },
  'appr.cancel': { ru: 'Отменить маршрут', en: 'Cancel workflow' },
  'appr.cancelled': { ru: 'Маршрут согласования отменён.', en: 'Approval workflow cancelled.' },
  'appr.started': { ru: 'Маршрут запущен — первый согласующий получил письмо.', en: 'Workflow started — the first approver got an email.' },
  'appr.empty': {
    ru: 'Маршрутов пока не было. Отправьте документ по цепочке: юрист → руководитель → директор.',
    en: 'No workflows yet. Route the document through a chain: lawyer → manager → director.',
  },
  'appr.upgrade': {
    ru: 'Маршруты согласования доступны на планах Pro и Business.',
    en: 'Approval workflows are available on Pro and Business plans.',
  },
  'appr.modalTitle': { ru: 'Маршрут согласования', en: 'Approval workflow' },
  'appr.modalHint': {
    ru: 'Добавьте шаги по порядку — каждый следующий получит письмо только после решения предыдущего. Дедлайн необязателен: при просрочке придёт напоминание.',
    en: 'Add steps in order — each next approver is emailed only after the previous decision. Deadline is optional: an overdue step triggers a reminder.',
  },
  'appr.stepN': { ru: 'Шаг {n}', en: 'Step {n}' },
  'appr.name': { ru: 'Имя и фамилия', en: 'Full name' },
  'appr.role': { ru: 'Роль (например, Юрист)', en: 'Role (e.g. Lawyer)' },
  'appr.deadline': { ru: 'Дедлайн', en: 'Deadline' },
  'appr.addStep': { ru: 'Добавить шаг', en: 'Add step' },
  'appr.submit': { ru: 'Запустить маршрут', en: 'Start workflow' },
  'appr.errSteps': { ru: 'У каждого шага должны быть имя и корректный email.', en: 'Every step needs a name and a valid email.' },
  'appr.copyLink': { ru: 'Ссылка', en: 'Link' },
  'appr.linkCopied': { ru: 'Ссылка для решения скопирована.', en: 'Decision link copied.' },
  'appr.due': { ru: 'срок', en: 'due' },
  'appr.flow.active': { ru: 'Идёт согласование', en: 'In progress' },
  'appr.flow.approved': { ru: 'Согласовано всеми', en: 'Fully approved' },
  'appr.flow.rejected': { ru: 'Отклонено', en: 'Rejected' },
  'appr.flow.cancelled': { ru: 'Отменено', en: 'Cancelled' },
  'appr.step.waiting': { ru: 'Ожидает очереди', en: 'Waiting' },
  'appr.step.pending': { ru: 'На рассмотрении', en: 'Reviewing now' },
  'appr.step.approved': { ru: 'Согласовано', en: 'Approved' },
  'appr.step.rejected': { ru: 'Отклонено', en: 'Rejected' },
  'appr.invalidTitle': { ru: 'Ссылка недействительна', en: 'This link is not valid' },
  'appr.requestedBy': { ru: '{name} ({firm}) просит вас согласовать документ.', en: '{name} ({firm}) asks for your approval.' },
  'appr.yourStep': { ru: 'ваша роль', en: 'your role' },
  'appr.commentPh': { ru: 'Комментарий (необязательно)…', en: 'Comment (optional)…' },
  'appr.approve': { ru: 'Согласовать', en: 'Approve' },
  'appr.reject': { ru: 'Отклонить', en: 'Reject' },
  'appr.notYourTurn': { ru: 'Сейчас очередь другого согласующего — мы пришлём письмо, когда наступит ваша.', en: 'It is another approver’s turn — you will get an email when yours comes.' },
  'appr.doneApproved': { ru: 'Вы согласовали документ', en: 'You approved the document' },
  'appr.doneRejected': { ru: 'Вы отклонили документ', en: 'You rejected the document' },
  'appr.doneBody': { ru: 'Решение по «{doc}» зафиксировано, автор получил уведомление.', en: 'Your decision on “{doc}” is recorded and the author has been notified.' },

  // Agentic workflows — run a chain of actions over a document
  'workflow.title': { ru: 'Агентный сценарий', en: 'Agentic workflow' },
  'workflow.run': { ru: 'Прогнать сценарий', en: 'Run workflow' },
  'workflow.empty': {
    ru: 'Прогоните документ по сценарию: анализ, авто-принятие правок и отправка на согласование — в один клик.',
    en: 'Run the document through a workflow: analysis, auto-accepting redlines and sending for approval — in one click.',
  },
  'workflow.upgrade': {
    ru: 'Агентные сценарии доступны на планах Pro и Business.',
    en: 'Agentic workflows are available on Pro and Business plans.',
  },
  'workflow.modalTitle': { ru: 'Прогнать сценарий', en: 'Run workflow' },
  'workflow.modalHint': {
    ru: 'Отметьте шаги — они выполнятся по порядку, сверху вниз.',
    en: 'Tick the steps — they run in order, top to bottom.',
  },
  'workflow.stepAnalyze': { ru: 'Анализ и сверка с законом', en: 'Analyse & check against law' },
  'workflow.stepAnalyzeDesc': {
    ru: 'Заново проанализировать документ и сверить с законодательством.',
    en: 'Re-analyse the document and re-check it against the law.',
  },
  'workflow.stepRedlines': { ru: 'Автоматически принять правки', en: 'Auto-accept redlines' },
  'workflow.stepRedlinesDesc': {
    ru: 'Принять предложенные правки этой серьёзности и выше.',
    en: 'Accept proposed redlines at this severity and above.',
  },
  'workflow.minSeverity': { ru: 'Серьёзность от', en: 'Severity from' },
  'workflow.stepApproval': { ru: 'Отправить на согласование', en: 'Send for approval' },
  'workflow.stepApprovalDesc': {
    ru: 'Запустить маршрут согласования по цепочке согласующих.',
    en: 'Start an approval chain through the listed approvers.',
  },
  'workflow.submit': { ru: 'Запустить', en: 'Run' },
  'workflow.started': { ru: 'Сценарий запущен.', en: 'Workflow started.' },
  'workflow.done': { ru: 'Сценарий выполнен.', en: 'Workflow complete.' },
  'workflow.errEmpty': { ru: 'Выберите хотя бы один шаг.', en: 'Choose at least one step.' },
  'workflow.badgeRunning': { ru: 'Выполняется', en: 'Running' },
  'workflow.badgeDone': { ru: 'Готово', en: 'Complete' },
  'workflow.badgeFailed': { ru: 'Ошибка', en: 'Failed' },

  // Plan purchase (pre-Stripe activation)
  'plans.renew': { ru: 'Обновить лимиты', en: 'Renew limits' },
  'plans.activatedMonthly': { ru: 'Подписка {plan} активирована — лимиты обновлены.', en: '{plan} plan activated — limits refreshed.' },
  'plans.activatedYearly': { ru: 'Подписка {plan} (годовая, −{d}%) активирована — лимиты обновлены.', en: '{plan} plan (yearly, −{d}%) activated — limits refreshed.' },
  'plans.changed': { ru: 'Тариф изменён на {plan} — разница досчитана проратой.', en: 'Plan changed to {plan} — the difference is prorated.' },
  'plans.currentBtn': { ru: 'Текущий план', en: 'Current plan' },
  'plans.switchPeriod': { ru: 'Сменить период оплаты', en: 'Switch billing period' },
  'plans.paymentProcessing': { ru: 'Обрабатываем оплату — обычно это занимает несколько секунд…', en: 'Processing your payment — this usually takes a few seconds…' },
  'plans.paymentDone': { ru: 'Оплата получена — подписка {plan} активирована!', en: 'Payment received — your {plan} plan is active!' },
  'plans.paymentTimeout': { ru: 'Оплата ещё обрабатывается. Обновите страницу через минуту — доступ включится автоматически.', en: 'The payment is still processing. Refresh in a minute — access will switch on automatically.' },

  // Email verification
  'verify.banner': {
    ru: 'Подтвердите почту {email} — мы отправили письмо со ссылкой. Без подтверждения нельзя принимать приглашения в команды.',
    en: 'Verify {email} — we sent you a confirmation link. Team invitations stay locked until then.',
  },
  'verify.resend': { ru: 'Отправить ещё раз', en: 'Resend' },
  'verify.resent': { ru: 'Письмо отправлено повторно.', en: 'Verification email sent again.' },
  'verify.invalid': { ru: 'Ссылка недействительна или уже использована.', en: 'The link is invalid or already used.' },
  'verify.doneTitle': { ru: 'Почта подтверждена', en: 'Email verified' },
  'verify.doneBody': {
    ru: 'Спасибо! Теперь вам доступны все возможности Lexab, включая команды.',
    en: 'Thank you! All Lexab features are now available, including teams.',
  },
  'verify.errorTitle': { ru: 'Не получилось', en: 'Something went wrong' },
  'verify.toApp': { ru: 'В приложение', en: 'Open the app' },
  'verify.toTeam': { ru: 'Перейти к приглашению в команду', en: 'Go to your team invitation' },
  'verify.toLogin': { ru: 'Войти', en: 'Sign in' },

  // Password reset page
  'reset.title': { ru: 'Новый пароль', en: 'New password' },
  'reset.sub': {
    ru: 'Придумайте новый пароль (минимум 8 символов) — после сохранения вы сразу войдёте в аккаунт.',
    en: 'Choose a new password (min 8 characters) — you will be signed in right after saving.',
  },
  'reset.newPassword': { ru: 'Новый пароль', en: 'New password' },
  'reset.submit': { ru: 'Сохранить и войти', en: 'Save and sign in' },
  'reset.done': { ru: 'Пароль обновлён — вы вошли в аккаунт.', en: 'Password updated — you are signed in.' },

  // Undo-delete
  'rail.deleting': { ru: 'Чат будет удалён…', en: 'Deleting chat…' },
  'rail.deleteCancelled': { ru: 'Удаление отменено.', en: 'Deletion cancelled.' },
  'common.undo': { ru: 'Отменить', en: 'Undo' },

  // Onboarding tour (first run)
  'onboard.step1Title': { ru: 'Анализируйте контракты', en: 'Analyze contracts' },
  'onboard.step1Body': {
    ru: 'Перетащите документ в чат — Lexab разберёт риски и предложит правки со ссылками на закон.',
    en: 'Drop a document into the chat — Lexab surfaces risks and suggests redlines with citations.',
  },
  'onboard.step2Title': { ru: 'Рабочая область правок', en: 'Redline workspace' },
  'onboard.step2Body': {
    ru: 'Принимайте или отклоняйте изменения по одному, экспортируйте DOCX и отправляйте на подпись.',
    en: 'Accept or reject changes one by one, export DOCX, and send for signature.',
  },
  'onboard.step3Title': { ru: 'Быстрые команды', en: 'Quick commands' },
  'onboard.step3Body': {
    ru: 'Нажмите ⌘K для перехода куда угодно, или / в чате для команд /draft, /compare, /translate.',
    en: 'Press ⌘K to jump anywhere, or / in chat for /draft, /compare, /translate.',
  },
  'onboard.skip': { ru: 'Пропустить', en: 'Skip' },
  'onboard.next': { ru: 'Далее', en: 'Next' },
  'onboard.start': { ru: 'Начать', en: 'Get started' },

  // Error boundary
  'error.title': { ru: 'Что-то пошло не так', en: 'Something went wrong' },
  'error.body': {
    ru: 'Произошла непредвиденная ошибка интерфейса. Попробуйте перезагрузить страницу.',
    en: 'An unexpected interface error occurred. Try reloading the page.',
  },
  'error.retry': { ru: 'Повторить', en: 'Retry' },
  'error.reload': { ru: 'Перезагрузить', en: 'Reload' },

  // 404
  'nf.title': { ru: 'Страница не найдена', en: 'Page not found' },
  'nf.body': {
    ru: 'Такой страницы нет или она была перемещена.',
    en: "We couldn't find that page — it may have been moved.",
  },
  'nf.cta': { ru: 'Вернуться в чат', en: 'Back to chat' },

  // «Обсудить в чате» на карточке находки
  'ws.discuss': { ru: 'Обсудить в чате', en: 'Discuss in chat' },
  'ws.discussPrompt': {
    ru: 'Объясни находку «{title}» ({citation}): чем это грозит для меня и как безопаснее переформулировать пункт?',
    en: 'Explain the finding “{title}” ({citation}): what is the risk for me and how should the clause be reworded more safely?',
  },

  // Шкала лимита в чате (≥80% месячного потолка ИИ-запросов)
  'chat.usage.nearLimit': {
    ru: 'Использовано {used} из {limit} ИИ-запросов в этом месяце',
    en: "You've used {used} of {limit} AI requests this month",
  },

  // Текст нормы под находкой (официальный корпус)
  'law.show': { ru: 'Текст нормы', en: 'Law text' },
  'law.hide': { ru: 'Скрыть текст', en: 'Hide text' },
  'law.failed': { ru: 'Не удалось загрузить текст нормы', en: 'Couldn’t load the provision text' },
  'law.source': { ru: 'Официальный источник', en: 'Official source' },
  'law.retrieved': { ru: 'снимок от', en: 'retrieved' },

  // Настройки → Почта (дайджест + приём договоров)
  'mail.title': { ru: 'Почта', en: 'Email' },
  'mail.sub': { ru: 'Сводки и приём договоров по email', en: 'Digests and email contract intake' },
  'mail.digest': { ru: 'Еженедельная сводка', en: 'Weekly digest' },
  'mail.digestSub': {
    ru: 'Каждый понедельник: что ждёт согласования и подписи, какие договоры истекают',
    en: 'Every Monday: pending approvals and signatures, contracts about to expire',
  },
  'mail.digestOn': { ru: 'Включить', en: 'Turn on' },
  'mail.digestOff': { ru: 'Отключить', en: 'Turn off' },
  'mail.intake': { ru: 'Приём договоров по email', en: 'Email a contract' },
  'mail.intakeSub': {
    ru: 'Отправьте договор с почты аккаунта на этот адрес — анализ появится в приложении',
    en: 'Send a contract from your account email to this address — the analysis appears in the app',
  },
  'mail.intakeCopy': { ru: 'Копировать', en: 'Copy' },
  'mail.intakeCopied': { ru: 'Адрес скопирован', en: 'Address copied' },

  // Готовые экспертные наборы плейбуков
  'playbooks.packsTitle': { ru: 'Готовые наборы', en: 'Ready-made packs' },
  'playbooks.packsSub': {
    ru: 'Экспертные позиции под юрисдикцию — установите в один клик и правьте под себя',
    en: 'Expert positions per jurisdiction — install in one click and tailor to your needs',
  },
  'playbooks.packInstall': { ru: 'Установить', en: 'Install' },
  'playbooks.packInstalled': { ru: 'Набор установлен — правила уже применяются к анализам', en: 'Pack installed — the rules now apply to analyses' },
  'playbooks.packInstalledBadge': { ru: 'Установлен', en: 'Installed' },

  // Онбординг: образец анализа

  // Публичная ссылка на отчёт
  'ws.share': { ru: 'Поделиться', en: 'Share' },
  'ws.fullView': { ru: 'Весь договор', en: 'Full contract' },
  'ws.shareTitle': { ru: 'Ссылка на отчёт', en: 'Report link' },
  'ws.shareBody': {
    ru: 'Любой, у кого есть эта ссылка, увидит краткий отчёт: балл риска, резюме и находки с цитатами норм. Текст договора и правки не показываются.',
    en: 'Anyone with this link sees a brief report: risk score, summary and findings with law citations. The contract text and edits are not shown.',
  },
  'ws.shareCopy': { ru: 'Копировать ссылку', en: 'Copy link' },
  'ws.shareCopied': { ru: 'Ссылка скопирована', en: 'Link copied' },
  'ws.shareRevoke': { ru: 'Отозвать ссылку', en: 'Revoke link' },
  'ws.shareRevoked': { ru: 'Ссылка отозвана — отчёт больше не открывается', en: 'Link revoked — the report is no longer accessible' },
  'share.invalidTitle': { ru: 'Ссылка недействительна', en: 'Link is invalid' },
  'share.invalidBody': { ru: 'Отчёт отозван владельцем или ссылка устарела.', en: 'The report was revoked by its owner or the link is stale.' },
  'share.preparedBy': { ru: 'Отчёт подготовлен: {firm}', en: 'Prepared by {firm}' },
  'share.riskScore': { ru: 'Балл риска', en: 'Risk score' },
  'share.clauses': { ru: 'Пунктов проверено', en: 'Clauses reviewed' },
  'share.findings': { ru: 'Находок', en: 'Findings' },
  'share.disclaimer': {
    ru: 'Отчёт сформирован в Lexab и носит информационный характер — это не юридическое заключение. Отметка «Проверено» означает подтверждение цитаты по базе официальных источников законодательства.',
    en: 'This report was generated in Lexab for information purposes — it is not legal advice. “Verified” marks citations confirmed against official statute sources.',
  },
  'share.cta': { ru: 'Проверить свой договор бесплатно', en: 'Check your own contract for free' },

  // Сводный отчёт массового разбора
  'batch.report': { ru: 'Сводный отчёт', en: 'Portfolio report' },

  // Slack / Teams вебхуки
  'hooks.sub': { ru: 'Дублировать уведомления в канал команды', en: 'Mirror notifications to your team channel' },
  'hooks.connected': { ru: 'Подключено', en: 'Connected' },
  'hooks.connect': { ru: 'Подключить', en: 'Connect' },
  'hooks.disconnect': { ru: 'Отключить', en: 'Disconnect' },
  'hooks.test': { ru: 'Тест', en: 'Test' },
  'hooks.testOk': { ru: 'Тестовое сообщение отправлено — проверьте канал', en: 'Test message sent — check the channel' },
  'hooks.testFail': { ru: 'Сообщение не дошло — проверьте адрес вебхука', en: 'The message did not arrive — check the webhook URL' },
  'hooks.saved': { ru: 'Вебхук сохранён — уведомления будут дублироваться в канал', en: 'Webhook saved — notifications will be mirrored to the channel' },
  'hooks.removed': { ru: 'Вебхук отключён', en: 'Webhook disconnected' },
  'hooks.urlLabel': { ru: 'Адрес вебхука', en: 'Webhook URL' },

  // Аналитика: деньги под риском
  'an.var': { ru: 'Деньги под риском', en: 'Value at risk' },
  'an.varSub': {
    ru: 'Стоимость договоров (из условий CLM) по уровню риска документа',
    en: 'Contract value (from CLM terms) grouped by document risk level',
  },
  'an.varHigh': { ru: 'Высокий риск', en: 'High risk' },
  'an.varElevated': { ru: 'Повышенный', en: 'Elevated' },
  'an.varLow': { ru: 'Низкий', en: 'Low' },
  'an.varTotal': { ru: 'Всего', en: 'Total' },
  'an.varExpiring': { ru: 'Истекают в этом квартале', en: 'Expiring this quarter' },
  'an.varExpiringSub': {
    ru: 'Высокорисковые договоры со сроком окончания в ближайшие 3 месяца',
    en: 'High-risk contracts expiring within the next 3 months',
  },
  'an.varNoCurrency': { ru: 'Без валюты', en: 'No currency' },

  // Раздел «API» (тариф Business): ключи, статистика, документация
  'api.title': { ru: 'API', en: 'API' },
  'api.sub': {
    ru: 'Подключите анализ договоров Lexab к своим системам: CRM, документообороту или собственному продукту.',
    en: 'Connect Lexab contract analysis to your own systems: CRM, document flow or your own product.',
  },
  'api.upsellTitle': { ru: 'API доступен на тарифе Business', en: 'API access is a Business feature' },
  'api.upsellBody': {
    ru: 'Ключи API, 1000 анализов в месяц и интеграция в ваши продукты — на тарифе Business.',
    en: 'API keys, 1,000 analyses per month and integration into your products — on the Business plan.',
  },
  'api.upsellCta': { ru: 'Перейти на Business', en: 'Upgrade to Business' },
  'api.keys': { ru: 'Ключи API', en: 'API keys' },
  'api.keysSub': {
    ru: 'Секрет показывается один раз при создании — храните его в менеджере секретов, не в коде.',
    en: 'The secret is shown once at creation — keep it in a secrets manager, not in code.',
  },
  'api.createKey': { ru: 'Создать ключ', en: 'Create key' },
  'api.keyLabel': { ru: 'Название ключа', en: 'Key label' },
  'api.keyLabelHint': { ru: 'Например: «Продакшен-бэкенд» или «CRM-интеграция»', en: 'For example: “Production backend” or “CRM integration”' },
  'api.keyCreated': { ru: 'Ключ создан — скопируйте его сейчас', en: 'Key created — copy it now' },
  'api.keyShownOnce': {
    ru: 'Мы показываем полный ключ только один раз. Потеряли — отзовите и создайте новый.',
    en: 'The full key is shown only once. If you lose it, revoke it and create a new one.',
  },
  'api.copy': { ru: 'Скопировать', en: 'Copy' },
  'api.copied': { ru: 'Ключ скопирован в буфер', en: 'Key copied to clipboard' },
  'api.copiedCmd': { ru: 'Команда скопирована', en: 'Command copied' },
  'api.copyFail': { ru: 'Не удалось скопировать — выделите и скопируйте вручную', en: 'Copy failed — select and copy manually' },
  'api.done': { ru: 'Готово', en: 'Done' },
  'api.revoke': { ru: 'Отозвать', en: 'Revoke' },
  'api.revokeConfirm': {
    ru: 'Отозвать ключ «{label}»? Интеграции с этим ключом сразу перестанут работать.',
    en: 'Revoke “{label}”? Integrations using this key will stop working immediately.',
  },
  'api.revoked': { ru: 'Ключ отозван', en: 'Key revoked' },
  'api.noKeys': { ru: 'Ключей пока нет — создайте первый', en: 'No keys yet — create your first one' },
  'api.created': { ru: 'Создан', en: 'Created' },
  'api.lastUsed': { ru: 'Последний вызов', en: 'Last used' },
  'api.neverUsed': { ru: 'ещё не использовался', en: 'never used' },
  'api.scopesTitle': { ru: 'Права ключа', en: 'Key permissions' },
  'api.scopesHint': {
    ru: 'Отмечены все права — ключ получит полный доступ. Снимите лишние, чтобы ограничить.',
    en: 'All permissions checked — the key gets full access. Untick some to restrict it.',
  },
  'api.scopesNone': { ru: 'Выберите хотя бы одно право — ключ без прав бесполезен', en: 'Select at least one permission — a key with none is useless' },
  'api.scope.analyses:read': { ru: 'чтение анализов', en: 'read analyses' },
  'api.scope.analyses:write': { ru: 'отправка на анализ', en: 'submit analyses' },
  'api.scope.drafts:write': { ru: 'черновики договоров', en: 'contract drafts' },
  'api.scope.compares:write': { ru: 'сравнение версий', en: 'compare versions' },
  'api.scope.templates:write': { ru: 'шаблоны и генерация', en: 'templates & generation' },
  'api.scope.webhooks:manage': { ru: 'управление вебхуками', en: 'manage webhooks' },
  'api.fullAccess': { ru: 'Полный доступ', en: 'Full access' },
  'api.expiryTitle': { ru: 'Срок действия', en: 'Expiry' },
  'api.expiryNone': { ru: 'Бессрочно', en: 'No expiry' },
  'api.expiryDays': { ru: '{days} дней', en: '{days} days' },
  'api.expiresOn': { ru: 'до {date}', en: 'until {date}' },
  'api.noExpiry': { ru: 'Бессрочный', en: 'Never expires' },
  'api.expiredBadge': { ru: 'Истёк', en: 'Expired' },
  'api.createdByLabel': { ru: 'Создал: {name}', en: 'Created by {name}' },
  'api.rotate': { ru: 'Ротация', en: 'Rotate' },
  'api.rotateConfirm': {
    ru: 'Перевыпустить ключ «{label}»? Старый секрет перестанет работать сразу; новый ключ получит те же название и права.',
    en: 'Rotate “{label}”? The old secret stops working immediately; the new key keeps the same label and permissions.',
  },
  'api.rotated': { ru: 'Ключ перевыпущен — скопируйте новый секрет', en: 'Key rotated — copy the new secret' },
  'api.usage': { ru: 'Использование', en: 'Usage' },
  'api.usageSub': { ru: 'Вызовы публичного API за последние 30 дней', en: 'Public API calls over the last 30 days' },
  'api.usedThisMonth': { ru: 'Вызовов в этом месяце', en: 'Calls this month' },
  'api.remaining': { ru: 'Осталось из {limit}', en: 'Remaining of {limit}' },
  'api.unlimited': { ru: 'Безлимит', en: 'Unlimited' },
  'api.activeKeys': { ru: 'Активных ключей', en: 'Active keys' },
  'api.recentCalls': { ru: 'Последние вызовы', en: 'Recent calls' },
  'api.noCalls': { ru: 'Вызовов ещё не было — начните с примера из документации ниже', en: 'No calls yet — start with the example from the docs below' },
  'api.status.done': { ru: 'Готово', en: 'Done' },
  'api.status.processing': { ru: 'В работе', en: 'Processing' },
  'api.status.error': { ru: 'Ошибка', en: 'Error' },
  'api.docs': { ru: 'Документация', en: 'Documentation' },
  'api.docsSub': {
    ru: 'Три эндпоинта: отправить договор, забрать результат, проверить остаток. Анализ асинхронный — отправили и опрашиваете статус.',
    en: 'Three endpoints: submit a contract, fetch the result, check your quota. Analysis is asynchronous — submit, then poll the status.',
  },
  'api.docsAuth': { ru: 'Аутентификация', en: 'Authentication' },
  'api.docsAuthBody': {
    ru: 'Передавайте ключ в каждом запросе: заголовок Authorization: Bearer <ключ> или X-API-Key: <ключ>. Ключ действует, пока активен тариф Business и ключ не отозван.',
    en: 'Send the key with every request: Authorization: Bearer <key> or X-API-Key: <key>. The key works while the Business plan is active and the key is not revoked.',
  },
  'api.docsCreate': { ru: '1. Отправить договор на анализ', en: '1. Submit a contract for analysis' },
  'api.docsCreateBody': {
    ru: 'JSON с текстом договора (поле text) или файл (multipart, поле file: pdf/docx/txt). Ответ 202 с id — анализ идёт 1–5 минут.',
    en: 'JSON with the contract text (field text) or a file (multipart, field file: pdf/docx/txt). Responds 202 with an id — analysis takes 1–5 minutes.',
  },
  'api.docsPoll': { ru: '2. Забрать результат', en: '2. Fetch the result' },
  'api.docsPollBody': {
    ru: 'Опрашивайте статус раз в 5–10 секунд. status: processing → done (риск, находки, проверенные цитаты законов) или error с причиной.',
    en: 'Poll every 5–10 seconds. status: processing → done (risk, findings, verified law citations) or error with a reason.',
  },
  'api.docsUsage': { ru: '3. Остаток лимита', en: '3. Check your quota' },
  'api.docsUsageBody': {
    ru: 'Лимиты: {limit} анализов в месяц на аккаунт и 60 запросов в минуту (бёрст-лимит). Превышение — ошибка 429 с кодом monthly_limit_exceeded или rate_limited.',
    en: 'Limits: {limit} analyses per month per account and 60 requests per minute (burst limit). Exceeding returns 429 with monthly_limit_exceeded or rate_limited.',
  },
  'api.docsMore': { ru: 'Ещё возможности через API', en: 'More capabilities via API' },
  'api.docsMoreBody': {
    ru: 'Кроме анализа, через API доступны: сравнение версий, генерация черновиков и по шаблонам. Все — асинхронно (отправил → опрашиваешь статус), как анализ; каждый вызов тратит один месячный юнит.',
    en: 'Beyond analysis, the API also offers version comparison, draft generation and templates. All asynchronous (submit → poll), like analysis; each call spends one monthly unit.',
  },
  'api.docsDraft': { ru: 'Черновик договора из промпта', en: 'Contract draft from a prompt' },
  'api.docsCompare': { ru: 'Сравнение двух версий', en: 'Compare two versions' },
  'api.docsTemplate': { ru: 'Каталог шаблонов и генерация', en: 'Template catalog & generation' },
  'api.docsWebhooks': { ru: 'Вебхуки и ссылка-отчёт', en: 'Webhooks & report link' },
  'api.docsWebhooksBody': {
    ru: 'Не хотите опрашивать статус — зарегистрируйте вебхук: когда задание готово, мы сами POST-им подписанное уведомление на ваш URL (проверьте X-Lexab-Signature секретом). А ?report=1 у готового анализа возвращает ссылку на страницу-отчёт, которую можно показать человеку.',
    en: 'Don’t want to poll — register a webhook: when a job finishes we POST a signed notification to your URL (verify X-Lexab-Signature with your secret). And ?report=1 on a finished analysis returns a link to a viewable report page you can show a human.',
  },
  'api.docsIdem': { ru: 'Идемпотентность и права ключа', en: 'Idempotency & key permissions' },
  'api.docsIdemBody': {
    ru: 'Передавайте заголовок Idempotency-Key (любая уникальная строка) на любой POST /v1/* — повтор с тем же значением вернёт тот же результат, не создаст дубль и не спишет юнит. Если ключ создан с ограниченными правами, запрос вне этих прав вернёт 403 insufficient_scope.',
    en: 'Send an Idempotency-Key header (any unique string) on any POST /v1/* — a retry with the same value returns the same result, creates no duplicate and consumes no unit. If a key was created with restricted permissions, a request outside them returns 403 insufficient_scope.',
  },
  'api.docsErrors': { ru: 'Ошибки', en: 'Errors' },
  'api.docsErrorsBody': {
    ru: 'Все ошибки приходят как JSON { error: { code, message } }: 401 invalid_api_key, 403 plan_required, 404 not_found, 429 monthly_limit_exceeded / rate_limited.',
    en: 'All errors come as JSON { error: { code, message } }: 401 invalid_api_key, 403 plan_required, 404 not_found, 429 monthly_limit_exceeded / rate_limited.',
  },
  'api.plan': { ru: 'Тариф и оплата', en: 'Plan & billing' },
  'api.planSub': {
    ru: 'API входит в тариф Business. Оплата и чеки — в Настройках, смена тарифа — на странице «Тарифы».',
    en: 'API access is part of the Business plan. Payment and receipts live in Settings; plan changes on the Plans page.',
  },
  'api.openSettings': { ru: 'Открыть настройки', en: 'Open settings' },
  'api.openPlans': { ru: 'Тарифы', en: 'Plans' },
  // Подписи под-навигации страницы API (вкладки). Ключи/Использование/
  // Документация переиспользуют api.keys/api.usage/api.docs — здесь только
  // короткая подпись вкладки «Тариф» и aria-заголовок списка вкладок.
  'api.tabPlan': { ru: 'Тариф', en: 'Plan' },
  'api.tabsAria': { ru: 'Разделы API', en: 'API sections' },
  // Интерактивная документация API (/developer/docs). Названия и описания
  // эндпоинтов приходят из OpenAPI-спеки на английском и НЕ переводятся.
  'api.docsPage.title': { ru: 'Документация API', en: 'API reference' },
  'api.docsPage.sub': {
    ru: 'Полное описание публичного API /v1: эндпоинты, схемы и готовые примеры кода. Технический контракт — на английском.',
    en: 'Complete reference for the public /v1 API: endpoints, schemas and ready-to-use code examples.',
  },
  'api.docsPage.open': { ru: 'Открыть полную документацию', en: 'Open full API reference' },
  'api.docsPage.back': { ru: 'К ключам API', en: 'Back to API keys' },
  'api.docsPage.download': { ru: 'Скачать openapi.json', en: 'Download openapi.json' },
  'api.docsPage.baseUrl': { ru: 'Базовый URL', en: 'Base URL' },
  'api.docsPage.version': { ru: 'версия {v}', en: 'version {v}' },
  'api.docsPage.endpoints': { ru: 'Эндпоинты', en: 'Endpoints' },
  'api.docsPage.params': { ru: 'Параметры', en: 'Parameters' },
  'api.docsPage.reqBody': { ru: 'Тело запроса', en: 'Request body' },
  'api.docsPage.responses': { ru: 'Ответы', en: 'Responses' },
  'api.docsPage.required': { ru: 'обязательно', en: 'required' },
  'api.docsPage.multipart': {
    ru: 'Альтернатива: multipart/form-data с полями {fields}.',
    en: 'Alternative: multipart/form-data with fields {fields}.',
  },
  // Projects (дела юристов): папки с договорами одного клиента/спора
  'nav.projects': { ru: 'Проекты', en: 'Projects' },
  'projects.title': { ru: 'Проекты', en: 'Projects' },
  'projects.sub': {
    ru: 'Дела: папки, где договоры одного клиента или спора лежат вместе',
    en: 'Matters: folders that keep the contracts of one client or case together',
  },
  'projects.new': { ru: 'Новый проект', en: 'New project' },
  'projects.create': { ru: 'Создать', en: 'Create' },
  'projects.name': { ru: 'Название', en: 'Name' },
  'projects.namePh': { ru: 'Например, «Дело Acme»', en: 'e.g. “Acme matter”' },
  'projects.needName': { ru: 'Введите название', en: 'Enter a name' },
  'projects.createdToast': { ru: 'Проект создан', en: 'Project created' },
  'projects.rename': { ru: 'Переименовать', en: 'Rename' },
  'projects.renamedToast': { ru: 'Проект переименован', en: 'Project renamed' },
  'projects.delete': { ru: 'Удалить', en: 'Delete' },
  'projects.deleteTitle': { ru: 'Удалить проект?', en: 'Delete the project?' },
  'projects.deleteBody': {
    ru: '«{name}» будет удалён. Договоры не удаляются — они вернутся в общий список «Документы».',
    en: '“{name}” will be deleted. Its contracts are not deleted — they return to the general Documents list.',
  },
  'projects.deletedToast': {
    ru: 'Проект удалён, договоры остались в «Документах»',
    en: 'Project deleted; its contracts remain in Documents',
  },
  'projects.empty': { ru: 'Пока нет проектов', en: 'No projects yet' },
  'projects.emptyBody': {
    ru: 'Создайте первое дело, чтобы держать договоры одного клиента вместе.',
    en: 'Create your first matter to keep one client’s contracts together.',
  },
  'projects.docsCount': { ru: 'Договоров: {n}', en: '{n} contracts' },
  'projects.cardMenu': { ru: 'Меню проекта', en: 'Project menu' },
  'projects.notFound': { ru: 'Проект не найден', en: 'Project not found' },
  'projects.backToList': { ru: 'К проектам', en: 'All projects' },
  'projects.newContract': { ru: 'Новый договор', en: 'New contract' },
  'projects.addExisting': { ru: 'Добавить существующий', en: 'Add existing' },
  'projects.addTitle': { ru: 'Добавить договор в проект', en: 'Add a contract to the project' },
  'projects.addSearchPh': { ru: 'Поиск по имени…', en: 'Search by name…' },
  'projects.addEmpty': {
    ru: 'Свободных договоров нет — все уже разложены по проектам.',
    en: 'No unassigned contracts — everything is already in a project.',
  },
  'projects.addNoMatch': { ru: 'Ничего не найдено', en: 'Nothing found' },
  'projects.addedToast': { ru: 'Договор добавлен в проект', en: 'Contract added to the project' },
  'projects.addFailedToast': {
    ru: 'Не удалось добавить договор в проект',
    en: 'Couldn’t add the contract to the project',
  },
  'projects.removeFromProject': { ru: 'Убрать из проекта', en: 'Remove from project' },
  'projects.removedToast': { ru: 'Договор возвращён в общий список', en: 'Contract returned to the general list' },
  'projects.emptyDocs': { ru: 'В проекте пока нет договоров', en: 'No contracts in this project yet' },
  'projects.emptyDocsBody': {
    ru: 'Загрузите новый договор или добавьте существующий.',
    en: 'Upload a new contract or add an existing one.',
  },
  'projects.toProject': { ru: 'В проект…', en: 'To a project…' },
  'projects.pickTitle': { ru: 'Выберите проект', en: 'Choose a project' },
  'projects.pickEmpty': {
    ru: 'Проектов пока нет — создайте первый в разделе «Проекты».',
    en: 'No projects yet — create one in the Projects section.',
  },
  'projects.current': { ru: 'Текущий', en: 'Current' },
};

/**
 * Язык интерфейса для загрузки: сохранённый выбор, иначе локаль браузера.
 * Живёт здесь (не в I18nProvider) — файл без компонентов, нужен bootstrap'у
 * main.tsx до первого рендера.
 */
export function loadLang(): Language {
  try {
    const stored = localStorage.getItem('lexai.lang');
    if (isLanguage(stored)) return stored;
  } catch {
    /* ignore */
  }
  // First visit: follow the browser locale. Map each supported language to its
  // locale prefix; Russian stays the default fallback for the CIS market.
  try {
    const locales = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
    for (const locale of locales) {
      if (/^ru\b/i.test(locale)) return 'ru';
      if (/^en\b/i.test(locale)) return 'en';
      if (/^ar\b/i.test(locale)) return 'ar';
      if (/^de\b/i.test(locale)) return 'de';
      if (/^kk\b/i.test(locale)) return 'kk';
      if (/^uz\b/i.test(locale)) return 'uz';
      // Other Russian-speaking locales still land on RU.
      if (/^(be|ky|tg)\b/i.test(locale)) return 'ru';
    }
    return locales.length > 0 ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

/**
 * Translate outside React (stores, class components): reads the persisted
 * language directly so non-hook code stays in the user's language too.
 */
export function tStandalone(key: string, params?: Record<string, string | number>): string {
  let lang: Language = 'ru';
  try {
    const stored = localStorage.getItem('lexai.lang');
    if (isLanguage(stored)) lang = stored;
    else if (typeof navigator !== 'undefined' && navigator.language.startsWith('en')) lang = 'en';
  } catch {
    /* default ru */
  }
  const text = resolveMessage(key, lang);
  if (text === undefined) return key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
