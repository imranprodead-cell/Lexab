/**
 * Lightweight i18n dictionary. Keys are dot-namespaced by feature. The
 * LanguageProvider resolves a key + optional interpolation params to a string.
 *
 * Adding a language = add a column to each entry. No runtime deps.
 */

import { EXTRA } from './translations';

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
export function pickText(entry: { ru: string; en: string }, lang: Language): string {
  return lang === 'ru' ? entry.ru : entry.en;
}

/**
 * Resolve a key for any language. RU/EN come from the base MESSAGES; the extra
 * languages come from their translation map, falling back to English (then the
 * raw key) when a string hasn't been translated yet.
 */
export function resolveMessage(key: string, lang: Language): string | undefined {
  const entry = MESSAGES[key];
  if (!entry) return undefined;
  if (lang === 'ru' || lang === 'en') return entry[lang];
  return EXTRA[lang]?.[key] ?? entry.en;
}

export const MESSAGES: Dict = {
  // Navigation
  'nav.chat': { ru: 'Чат', en: 'Chat' },
  'nav.documents': { ru: 'Документы', en: 'Documents' },
  'nav.templates': { ru: 'Шаблоны', en: 'Templates' },
  'nav.signatures': { ru: 'Э-подписи', en: 'E-signatures' },
  'nav.analytics': { ru: 'Аналитика', en: 'Analytics' },
  'nav.settings': { ru: 'Настройки', en: 'Settings' },
  'nav.team': { ru: 'Команда', en: 'Team' },
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
  'auth.termsB': { ru: ' LexAI.', en: ' of LexAI.' },

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
  'tpl.details': { ru: 'Особые условия (по желанию)', en: 'Special terms (optional)' },
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
  'an.citationsVerifiedShare': { ru: 'подтверждено по базе законов', en: 'verified against the statute base' },
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
  'finding.verified': { ru: 'Проверено по базе законов', en: 'Verified against law database' },
  'finding.unverified': { ru: 'Источник не подтверждён', en: 'Source not confirmed' },

  // Chat · analysis progress card
  'chat.an.workingTitle': { ru: 'Анализирую контракт', en: 'Analyzing contract' },
  'chat.an.doneTitle': { ru: 'Анализ завершён', en: 'Analysis complete' },
  'chat.an.badgeWork': { ru: 'В работе', en: 'Working' },
  'chat.an.badgeDone': { ru: 'Готово', en: 'Complete' },
  'chat.an.step1': { ru: 'Разбираю структуру документа', en: 'Parsing document structure' },
  'chat.an.step2': { ru: 'Сверяю с законодательством и практикой', en: 'Checking against statute & case law' },
  'chat.an.step3': { ru: 'Формирую отчёт о рисках', en: 'Building risk report' },

  // Chat · summary card
  'chat.sum.meta': { ru: 'Находок: {n} · проверено пунктов: {m}', en: '{n} findings · {m} clauses reviewed' },
  'chat.sum.top': { ru: 'Топ-{n} находок', en: 'Top {n} findings' },
  'chat.sum.followUp': { ru: 'Задать вопрос', en: 'Ask a follow-up' },
  'chat.thinking': { ru: 'LexAI думает…', en: 'LexAI is thinking…' },

  // Chat · message actions (below assistant replies)
  'chat.act.like': { ru: 'Хороший ответ', en: 'Good response' },
  'chat.act.dislike': { ru: 'Плохой ответ', en: 'Bad response' },
  'chat.act.copy': { ru: 'Копировать', en: 'Copy' },
  'chat.act.copied': { ru: 'Скопировано', en: 'Copied' },
  'chat.act.more': { ru: 'Ещё', en: 'More' },
  'chat.act.speak': { ru: 'Прочитать вслух', en: 'Read aloud' },
  'chat.act.speakStop': { ru: 'Остановить чтение', en: 'Stop reading' },
  'chat.act.downloadTxt': { ru: 'Скачать как .txt', en: 'Download as .txt' },
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
  'chat.upsell.title': { ru: 'Больше возможностей с LexAI', en: 'Get more with LexAI' },
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
  'chat.input.placeholder': { ru: 'Спросите LexAI…', en: 'Ask LexAI…' },
  'chat.disclaimer': {
    ru: 'LexAI может ошибаться. Проверяйте ссылки по первоисточникам.',
    en: 'LexAI can make mistakes. Verify citations against primary sources.',
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
  'cmp.changes': { ru: '{n} изменённых пунктов', en: '{n} changed clauses' },

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
  'docs.count': { ru: '{n} документов', en: '{n} documents' },

  // Auth
  'auth.signInTitle': { ru: 'Вход в LexAI', en: 'Sign in to LexAI' },
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
    ru: 'LexAI находит риски, готовит правки и отвечает на вопросы по документам — за минуты, а не часы.',
    en: 'LexAI finds risks, drafts redlines and answers questions about your documents — in minutes, not hours.',
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
  'auth.signingIn': { ru: 'Входим в LexAI…', en: 'Signing you in…' },
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
  'settings.sub': { ru: 'Управляйте профилем и внешним видом LexAI.', en: 'Manage your profile and how LexAI looks.' },
  'settings.plan': { ru: 'Подписка и лимиты', en: 'Plan & limits' },
  'settings.planSub': { ru: 'Ваш тариф и использование за текущий месяц.', en: 'Your plan and this month’s usage.' },
  'settings.changePlan': { ru: 'Изменить план', en: 'Change plan' },
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
  'chat.uploadFailed': {
    ru: 'Не удалось передать содержимое файла — анализ выполнен только по названию.',
    en: "Couldn't upload the file contents — the review used the file name only.",
  },
  'chat.micDenied': {
    ru: 'Разрешите доступ к микрофону в настройках браузера.',
    en: 'Allow microphone access in your browser settings.',
  },
  'chat.micStart': { ru: 'Голосовой ввод', en: 'Voice input' },
  'chat.micStop': { ru: 'Остановить запись', en: 'Stop recording' },
  'chat.attach': { ru: 'Прикрепить договор', en: 'Attach contract' },
  'chat.sendLabel': { ru: 'Отправить сообщение', en: 'Send message' },

  // Workspace
  'ws.review': { ru: 'Обзор', en: 'Review' },
  'ws.backToChat': { ru: 'Назад в чат', en: 'Back to chat' },
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
  'ws.suggestionsCount': { ru: '{n} правок', en: '{n} suggestions' },
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
  'plans.freeActive': { ru: 'План Free уже доступен — просто пользуйтесь LexAI.', en: 'The Free plan is already active — just use LexAI.' },

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

  // Plan purchase (pre-Stripe activation)
  'plans.renew': { ru: 'Обновить лимиты', en: 'Renew limits' },
  'plans.activatedMonthly': { ru: 'Подписка {plan} активирована — лимиты обновлены.', en: '{plan} plan activated — limits refreshed.' },
  'plans.activatedYearly': { ru: 'Подписка {plan} (годовая, −{d}%) активирована — лимиты обновлены.', en: '{plan} plan (yearly, −{d}%) activated — limits refreshed.' },

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
    ru: 'Спасибо! Теперь вам доступны все возможности LexAI, включая команды.',
    en: 'Thank you! All LexAI features are now available, including teams.',
  },
  'verify.errorTitle': { ru: 'Не получилось', en: 'Something went wrong' },
  'verify.toApp': { ru: 'В приложение', en: 'Open the app' },
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
};

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
