/**
 * Lightweight i18n dictionary. Keys are dot-namespaced by feature. The
 * LanguageProvider resolves a key + optional interpolation params to a string.
 *
 * Adding a language = add a column to each entry. No runtime deps.
 */

export type Language = 'ru' | 'en';

export const LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'en', label: 'English', short: 'EN' },
];

type Dict = Record<string, { ru: string; en: string }>;

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
  'rail.pinnedGroup': { ru: 'Закреплено', en: 'Pinned' },
  'rail.pin': { ru: 'Закрепить', en: 'Pin' },
  'rail.unpin': { ru: 'Открепить', en: 'Unpin' },
  'rail.rename': { ru: 'Переименовать', en: 'Rename' },
  'rail.archive': { ru: 'Архивировать', en: 'Archive' },
  'rail.delete': { ru: 'Удалить', en: 'Delete' },
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
  'tpl.details': { ru: 'Особые условия (по желанию)', en: 'Special terms (optional)' },
  'tpl.genRun': { ru: 'Сгенерировать', en: 'Generate' },
  'tpl.genReady': { ru: 'Черновик готов', en: 'Draft ready' },
  'tpl.download': { ru: 'Скачать .doc', en: 'Download .doc' },
  'tpl.copy': { ru: 'Копировать', en: 'Copy' },
  'tpl.copied': { ru: 'Скопировано в буфер обмена.', en: 'Copied to clipboard.' },

  // Workspace
  'ws.report': { ru: 'Отчёт (PDF)', en: 'Report (PDF)' },
  'ws.saved': { ru: 'Изменения сохранены.', en: 'Changes saved.' },
  'ws.editHint': { ru: 'Нажмите на абзац, чтобы отредактировать его', en: 'Click a paragraph to edit it' },

  // Templates
  'tpl.title': { ru: 'Шаблоны', en: 'Templates' },
  'tpl.sub': { ru: 'Начните черновик из проверенного шаблона под юрисдикцию.', en: 'Start a draft from a vetted, jurisdiction-ready template.' },
  'tpl.allCategories': { ru: 'Все категории', en: 'All categories' },
  'tpl.empty': { ru: 'Нет шаблонов в этой категории', en: 'No templates in this category' },
  'tpl.clauses': { ru: 'пунктов', en: 'clauses' },
  'tpl.start': { ru: 'Начать черновик из «{name}»…', en: 'Starting a draft from “{name}”…' },

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
  'an.contractsReviewed': { ru: 'Проверено контрактов', en: 'Contracts reviewed' },
  'an.avgRisk': { ru: 'Средний риск', en: 'Avg. risk score' },
  'an.highRisk': { ru: 'Находок высокого риска', en: 'High-risk findings' },
  'an.hoursSaved': { ru: 'Сэкономлено часов', en: 'Hours saved' },
  'an.hours': { ru: 'ч', en: 'hrs' },
  'an.perWeek': { ru: 'Обзоров в неделю', en: 'Reviews per week' },
  'an.bySeverity': { ru: 'Находки по серьёзности', en: 'Findings by severity' },

  // Team
  'team.title': { ru: 'Команда', en: 'Team' },
  'team.sub': { ru: 'Участники рабочего пространства и их роли (план Business).', en: 'Workspace members and their roles (Business plan).' },
  'team.invite': { ru: 'Пригласить участника', en: 'Invite member' },
  'team.inviteSent': { ru: 'Приглашение отправлено.', en: 'Invitation sent.' },
  'team.col.member': { ru: 'Участник', en: 'Member' },
  'team.col.role': { ru: 'Роль', en: 'Role' },
  'team.col.status': { ru: 'Статус', en: 'Status' },
  'team.role.owner': { ru: 'Владелец', en: 'Owner' },
  'team.role.admin': { ru: 'Админ', en: 'Admin' },
  'team.role.editor': { ru: 'Редактор', en: 'Editor' },
  'team.role.viewer': { ru: 'Наблюдатель', en: 'Viewer' },
  'team.status.active': { ru: 'Активен', en: 'Active' },
  'team.status.invited': { ru: 'Приглашён', en: 'Invited' },
  'team.inviteEmail': { ru: 'Email пользователя', en: "User's email" },
  'team.inviteRole': { ru: 'Роль', en: 'Role' },
  'team.inviteSend': { ru: 'Отправить приглашение', en: 'Send invitation' },
  'team.inviteHint': {
    ru: 'Участник появится в команде только после того, как примет приглашение в приложении.',
    en: 'The person joins the team only after accepting the invitation in the app.',
  },
  'team.invitedYou': { ru: '{name} ({firm}) приглашает вас в команду', en: '{name} ({firm}) invited you to their team' },
  'team.invitedRole': { ru: 'Ваша роль: ', en: 'Your role: ' },
  'team.accept': { ru: 'Принять', en: 'Accept' },
  'team.decline': { ru: 'Отклонить', en: 'Decline' },
  'team.acceptedToast': { ru: 'Вы присоединились к команде.', en: 'You joined the team.' },
  'team.declinedToast': { ru: 'Приглашение отклонено.', en: 'Invitation declined.' },

  // Top bar
  'top.upgrade': { ru: 'Обновить', en: 'Upgrade' },
  'top.theme.toLight': { ru: 'Светлая тема', en: 'Light theme' },
  'top.theme.toDark': { ru: 'Тёмная тема', en: 'Dark theme' },
  'top.search': { ru: 'Поиск', en: 'Search' },
  'top.notFound': { ru: 'Ничего не найдено', en: 'No results' },
  'top.notifications': { ru: 'Уведомления', en: 'Notifications' },
  'top.markAllRead': { ru: 'Отметить все', en: 'Mark all read' },
  'top.noNotifications': { ru: 'Пока нет уведомлений', en: 'No notifications yet' },

  // Plan / subscription
  'plan.pro': { ru: 'Pro · активна', en: 'Pro · active' },

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
  'chat.suggest.draft.body': { ru: 'Двусторонний, по праву Великобритании', en: 'Mutual, UK-governed' },
  'chat.suggest.compare.title': { ru: 'Сравнить версии', en: 'Compare versions' },
  'chat.suggest.compare.body': { ru: 'Различия двух черновиков по пунктам', en: 'Diff two drafts clause by clause' },
  'chat.input.placeholder': { ru: 'Спросите LexAI или введите / для команд…', en: 'Ask LexAI, or type / for commands…' },
  'chat.disclaimer': {
    ru: 'LexAI может ошибаться. Проверяйте ссылки по первоисточникам.',
    en: 'LexAI can make mistakes. Verify citations against primary sources.',
  },
  'chat.dropHere': { ru: 'Отпустите файл, чтобы загрузить', en: 'Drop the file to upload' },
  'chat.uploading': { ru: 'Загрузка…', en: 'Uploading…' },

  // Commands
  'cmd.analyze': { ru: 'Обзор контракта на юридические риски', en: 'Review a contract for legal risk' },
  'cmd.draft': { ru: 'Сгенерировать пункт или документ', en: 'Generate a clause or full document' },
  'cmd.compare': { ru: 'Сравнить две версии контракта', en: 'Diff two contract versions' },
  'cmd.translate': { ru: 'Перевести и локализовать текст', en: 'Translate & localise legal text' },
  'cmd.section': { ru: 'Команды', en: 'Commands' },

  // Compare
  'cmp.title': { ru: 'Сравнение версий', en: 'Compare versions' },
  'cmp.sub': { ru: 'Различия между двумя версиями договора по пунктам.', en: 'Differences between two contract versions, clause by clause.' },
  'cmp.removed': { ru: 'Удалено', en: 'Removed' },
  'cmp.added': { ru: 'Добавлено', en: 'Added' },
  'cmp.changes': { ru: '{n} изменённых пунктов', en: '{n} changed clauses' },

  // Analysis
  'analysis.working': { ru: 'Анализ контракта', en: 'Analyzing contract' },
  'analysis.done': { ru: 'Анализ завершён', en: 'Analysis complete' },
  'analysis.badge.working': { ru: 'В работе', en: 'Working' },
  'analysis.badge.done': { ru: 'Готово', en: 'Complete' },
  'analysis.step.parse': { ru: 'Разбор структуры документа', en: 'Parsing document structure' },
  'analysis.step.law': { ru: 'Проверка по закону и практике', en: 'Checking against statute & case law' },
  'analysis.step.report': { ru: 'Формирование отчёта о рисках', en: 'Building risk report' },
  'analysis.findings': { ru: 'критических находок', en: 'critical findings' },
  'analysis.clauses': { ru: 'пунктов проверено', en: 'clauses reviewed' },
  'analysis.riskScore': { ru: 'оценка риска', en: 'risk score' },
  'analysis.topFindings': { ru: 'Топ критических находок', en: 'Top critical findings' },
  'analysis.openWorkspace': { ru: 'Открыть рабочую область', en: 'Open workspace' },
  'analysis.followUp': { ru: 'Задать вопрос', en: 'Ask a follow-up' },
  'risk.Low': { ru: 'Низкий риск', en: 'Low risk' },
  'risk.Elevated': { ru: 'Повышенный риск', en: 'Elevated risk' },
  'risk.High': { ru: 'Высокий риск', en: 'High risk' },

  // Generic
  'common.retry': { ru: 'Повторить', en: 'Try again' },
  'common.loading': { ru: 'Загрузка…', en: 'Loading…' },
  'common.cancel': { ru: 'Отмена', en: 'Cancel' },
  'common.save': { ru: 'Сохранить', en: 'Save' },
  'common.error': { ru: 'Что-то пошло не так', en: 'Something went wrong' },
  'common.close': { ru: 'Закрыть', en: 'Close' },
  'common.back': { ru: 'Назад', en: 'Back' },
  'common.search': { ru: 'Поиск', en: 'Search' },

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
  'docs.open': { ru: 'Открыть документ', en: 'Open document' },
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
  'auth.errPassword': { ru: 'Пароль минимум 6 символов.', en: 'Password must be at least 6 characters.' },
  'auth.tagline': { ru: 'Интеллектуальный анализ контрактов', en: 'AI contract intelligence' },
  'auth.forgot': { ru: 'Забыли пароль?', en: 'Forgot password?' },
  'auth.resetTitle': { ru: 'Сброс пароля', en: 'Reset password' },
  'auth.resetHint': { ru: 'Укажите email — пришлём ссылку для сброса пароля.', en: "Enter your email — we'll send a reset link." },
  'auth.resetSend': { ru: 'Отправить ссылку', en: 'Send reset link' },
  'auth.resetSent': { ru: 'Ссылка для сброса отправлена на почту.', en: 'A reset link has been sent to your email.' },
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
  'auth.terms': {
    ru: 'Продолжая, вы принимаете Условия использования и Политику конфиденциальности LexAI.',
    en: 'By continuing, you agree to the LexAI Terms of Use and Privacy Policy.',
  },
  'auth.googleFailed': { ru: 'Не удалось войти через Google. Попробуйте ещё раз.', en: 'Google sign-in failed. Please try again.' },
  'auth.signingIn': { ru: 'Входим в LexAI…', en: 'Signing you in…' },

  // Settings
  'settings.title': { ru: 'Настройки', en: 'Settings' },
  'settings.sub': { ru: 'Управляйте профилем и внешним видом LexAI.', en: 'Manage your profile and how LexAI looks.' },
  'settings.plan': { ru: 'Подписка и лимиты', en: 'Plan & limits' },
  'settings.planSub': { ru: 'Ваш тариф и использование за текущий месяц.', en: 'Your plan and this month’s usage.' },
  'settings.changePlan': { ru: 'Изменить план', en: 'Change plan' },
  'limits.ai': { ru: 'AI-запросы в месяц', en: 'AI requests this month' },
  'limits.docs': { ru: 'Документы в месяц', en: 'Documents this month' },
  'limits.storage': { ru: 'Хранилище', en: 'Storage' },
  'limits.unlimited': { ru: 'Безлимит', en: 'Unlimited' },
  'settings.profile': { ru: 'Профиль', en: 'Profile' },
  'settings.avatar': { ru: 'Фото профиля', en: 'Profile photo' },
  'settings.avatarUpload': { ru: 'Загрузить фото', en: 'Upload photo' },
  'settings.avatarRemove': { ru: 'Удалить', en: 'Remove' },
  'settings.avatarHint': { ru: 'PNG или JPG, до 2 МБ.', en: 'PNG or JPG, up to 2 MB.' },
  'settings.appearance': { ru: 'Внешний вид', en: 'Appearance' },
  'settings.language': { ru: 'Язык', en: 'Language' },
  'settings.theme': { ru: 'Тема', en: 'Theme' },
  'settings.themeLight': { ru: 'Светлая', en: 'Light' },
  'settings.themeDark': { ru: 'Тёмная', en: 'Dark' },
  'settings.themeSystem': { ru: 'Системная', en: 'System' },
  'settings.accent': { ru: 'Акцентный цвет', en: 'Accent colour' },
  'settings.reduceMotion': { ru: 'Меньше анимации', en: 'Reduce motion' },
  'settings.reduceMotionDesc': { ru: 'Отключить стриминг текста и лишнюю анимацию.', en: 'Disable streaming text and non-essential animation.' },
  'settings.pinRail': { ru: 'Держать меню раскрытым', en: 'Keep sidebar expanded' },
  'settings.pinRailDesc': { ru: 'Закрепить панель навигации вместо раскрытия при наведении.', en: 'Pin the navigation rail open instead of expanding on hover.' },

  // Command palette
  'palette.placeholder': { ru: 'Куда перейти или что сделать…', en: 'Go to or do anything…' },
  'palette.nav': { ru: 'Навигация', en: 'Navigation' },
  'palette.actions': { ru: 'Действия', en: 'Actions' },
  'palette.action.newReview': { ru: 'Новый обзор', en: 'New review' },
  'palette.action.toggleTheme': { ru: 'Переключить тему', en: 'Toggle theme' },
  'palette.action.upgrade': { ru: 'Открыть тарифы', en: 'Open plans' },
};
