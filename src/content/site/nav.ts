/**
 * Меню сайта: шапка и подвал страниц-разделов.
 *
 * Здесь перечислены ВСЕ задуманные разделы, но наружу показываются только те,
 * чьи страницы реально существуют (сверка с реестром PUBLIC_SLUGS в самих
 * компонентах). Так меню не может показать ссылку в никуда: страница выходит —
 * пункт загорается сам, страницы нет — пункта нет.
 *
 * Пункт-якорь (`anchor`) ведёт к секции главной. Он показывается ТОЛЬКО там,
 * где есть чем его обработать: на главной, где шапка знает про прокрутку своего
 * контейнера. На страницах-разделах такие пункты скрыты — вход на главную по
 * хешу там намеренно отключён (AuthPage всегда открывается сверху), и ссылка
 * «/#plans» тихо не сработала бы.
 */
import type { Text6 } from '@/content/types';

export interface RouteNavItem {
  kind: 'route';
  /** Слаг публичной страницы из реестра src/pages/public/registry.ts. */
  slug: string;
  label: Text6;
}

export interface AnchorNavItem {
  kind: 'anchor';
  /** id секции главной страницы. */
  id: string;
  label: Text6;
}

export type NavItem = RouteNavItem | AnchorNavItem;

/** Пункты шапки: короткий ряд, не более пяти. */
export const HEADER_NAV: NavItem[] = [
  {
    kind: 'route',
    slug: 'contract-analysis',
    label: { ru: 'Анализ договора', en: 'Contract review', de: 'Vertragsprüfung', ar: 'مراجعة العقد', kk: 'Шартты талдау', uz: 'Shartnoma tahlili' },
  },
  {
    kind: 'route',
    slug: 'legal-base',
    label: { ru: 'База законов', en: 'Legal base', de: 'Gesetzesbasis', ar: 'قاعدة القوانين', kk: 'Заң базасы', uz: 'Qonunlar bazasi' },
  },
  {
    kind: 'route',
    slug: 'security',
    label: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
  },
  {
    kind: 'route',
    slug: 'for-developers',
    label: { ru: 'Разработчикам', en: 'Developers', de: 'Entwickler', ar: 'للمطورين', kk: 'Әзірлеушілерге', uz: 'Dasturchilarga' },
  },
  {
    kind: 'route',
    slug: 'pricing',
    label: { ru: 'Тарифы', en: 'Pricing', de: 'Preise', ar: 'الأسعار', kk: 'Тарифтер', uz: 'Tariflar' },
  },
];

/**
 * Правовые страницы. Отдельно от разделов сайта: это не слаги реестра, а
 * давно существующие маршруты приложения, и обязаны быть видны с любой страницы.
 */
export const LEGAL_LINKS: { to: string; label: Text6 }[] = [
  {
    to: '/terms',
    label: { ru: 'Условия использования', en: 'Terms of Use', de: 'Nutzungsbedingungen', ar: 'شروط الاستخدام', kk: 'Пайдалану шарттары', uz: 'Foydalanish shartlari' },
  },
  {
    to: '/privacy',
    label: { ru: 'Политика конфиденциальности', en: 'Privacy Policy', de: 'Datenschutzerklärung', ar: 'سياسة الخصوصية', kk: 'Құпиялылық саясаты', uz: 'Maxfiylik siyosati' },
  },
];

export interface FooterColumn {
  title: Text6;
  items: NavItem[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: { ru: 'Разбор договоров', en: 'Contract review', de: 'Vertragsprüfung', ar: 'مراجعة العقود', kk: 'Шарттарды талдау', uz: 'Shartnomalar tahlili' },
    items: [
      { kind: 'route', slug: 'contract-analysis', label: { ru: 'Анализ договора', en: 'Contract review', de: 'Vertragsprüfung', ar: 'مراجعة العقد', kk: 'Шартты талдау', uz: 'Shartnoma tahlili' } },
      { kind: 'route', slug: 'document-chat', label: { ru: 'Вопросы по документу', en: 'Document Q&A', de: 'Fragen zum Dokument', ar: 'أسئلة عن المستند', kk: 'Құжат бойынша сұрақтар', uz: 'Hujjat boʻyicha savollar' } },
      { kind: 'route', slug: 'version-compare', label: { ru: 'Сравнение редакций', en: 'Version compare', de: 'Versionsvergleich', ar: 'مقارنة النسخ', kk: 'Редакцияларды салыстыру', uz: 'Tahrirlarni solishtirish' } },
      { kind: 'route', slug: 'bulk-review', label: { ru: 'Пакетная проверка', en: 'Bulk review', de: 'Stapelprüfung', ar: 'مراجعة دفعية', kk: 'Топтама тексеру', uz: 'Paketli tekshiruv' } },
    ],
  },
  {
    title: { ru: 'Работа команды', en: 'Teamwork', de: 'Teamarbeit', ar: 'عمل الفريق', kk: 'Команда жұмысы', uz: 'Jamoa ishi' },
    items: [
      { kind: 'route', slug: 'contract-templates', label: { ru: 'Шаблоны договоров', en: 'Contract templates', de: 'Vertragsvorlagen', ar: 'قوالب العقود', kk: 'Шарт үлгілері', uz: 'Shartnoma shablonlari' } },
      { kind: 'route', slug: 'clause-playbooks', label: { ru: 'Правила по пунктам', en: 'Clause playbooks', de: 'Klausel-Playbooks', ar: 'أدلة البنود', kk: 'Тармақтар бойынша ережелер', uz: 'Bandlar boʻyicha qoidalar' } },
      { kind: 'route', slug: 'approvals-and-deadlines', label: { ru: 'Согласования и сроки', en: 'Approvals & deadlines', de: 'Freigaben und Fristen', ar: 'الموافقات والمواعيد', kk: 'Келісулер мен мерзімдер', uz: 'Kelishuvlar va muddatlar' } },
      { kind: 'route', slug: 'team-access', label: { ru: 'Доступы в команде', en: 'Team access', de: 'Teamzugriff', ar: 'صلاحيات الفريق', kk: 'Командадағы рұқсаттар', uz: 'Jamoadagi ruxsatlar' } },
    ],
  },
  {
    title: { ru: 'Основания и защита', en: 'Sources & safeguards', de: 'Grundlagen und Schutz', ar: 'المصادر والحماية', kk: 'Негіздер мен қорғау', uz: 'Asoslar va himoya' },
    items: [
      { kind: 'route', slug: 'legal-base', label: { ru: 'База законов', en: 'Legal base', de: 'Gesetzesbasis', ar: 'قاعدة القوانين', kk: 'Заң базасы', uz: 'Qonunlar bazasi' } },
      { kind: 'route', slug: 'security', label: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' } },
      { kind: 'route', slug: 'integrations', label: { ru: 'Интеграции', en: 'Integrations', de: 'Integrationen', ar: 'التكاملات', kk: 'Интеграциялар', uz: 'Integratsiyalar' } },
      { kind: 'route', slug: 'for-developers', label: { ru: 'Разработчикам', en: 'Developers', de: 'Entwickler', ar: 'للمطورين', kk: 'Әзірлеушілерге', uz: 'Dasturchilarga' } },
    ],
  },
];
