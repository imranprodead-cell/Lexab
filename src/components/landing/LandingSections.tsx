import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { EASE } from '@/lib/motion';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { useI18n } from '@/i18n/I18nProvider';
import { pickText } from '@/i18n/messages';
import { prefersReducedMotion, scrollBehavior } from '@/lib/scroll';
import { FOOTER_COLUMNS, HEADER_NAV } from '@/content/site/nav';
import type { Text6 } from '@/content/types';
import { PUBLIC_SLUGS } from '@/pages/public/registry';
import { publicPath } from '@/router/publicPaths';
import { LandingDemo, DEMO_NOTE } from './LandingDemo';
import styles from './landing.module.css';

/**
 * Карта разделов сайта берётся из ОБЩЕГО меню (src/content/site/nav.ts) и
 * фильтруется по реестру существующих страниц: главная не может показать
 * ссылку на раздел, которого нет, и не может забыть про новый раздел.
 */
const SITE_MAP = FOOTER_COLUMNS.map((col) => ({
  title: col.title,
  items: col.items.flatMap((item) => (item.kind === 'route' && PUBLIC_SLUGS.includes(item.slug) ? [item] : [])),
})).filter((col) => col.items.length > 0);

/** Bilingual copy lives next to the markup (same idiom as PlansPage.PLANS). */
type Text2 = { ru: string; en: string; de?: string; ar?: string; kk?: string; uz?: string };

const TELEGRAM_URL = 'https://t.me/MANAGER_CIVIS';

interface SectionHead {
  eyebrow: Text2;
  title: Text2;
  sub: Text2;
}

const HEADS: Record<string, SectionHead> = {
  features: {
    eyebrow: { ru: 'Возможности', en: 'Features', de: 'Funktionen', ar: 'المزايا', kk: 'Мүмкіндіктер', uz: 'Imkoniyatlar' },
    title: { ru: 'Что умеет Lexab', en: 'What Lexab does', de: 'Was Lexab kann', ar: 'ما الذي يقدّمه Lexab', kk: 'Lexab не істей алады', uz: 'Lexab nimalarga qodir' },
    sub: {
      ru: 'Анализ, правки, проверяемые цитаты и экспорт — полный цикл работы с договором.',
      en: 'Analysis, redlines, verifiable citations and export — the full contract workflow.', de: 'Analyse, Redlines, überprüfbare Zitate und Export – der komplette Workflow für Ihre Verträge.', ar: 'تحليل وتعديلات واستشهادات قابلة للتحقق وتصدير — دورة العمل الكاملة على العقد.', kk: 'Талдау, түзетулер, тексерілетін дәйексөздер және экспорт — шартпен жұмыстың толық циклі.', uz: 'Tahlil, tahrirlar, tekshiriladigan iqtiboslar va eksport — shartnoma bilan ishlashning toʻliq sikli.',
    },
  },
  how: {
    eyebrow: { ru: 'Процесс', en: 'Process', de: 'Ablauf', ar: 'آلية العمل', kk: 'Процесс', uz: 'Jarayon' },
    title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
    sub: {
      ru: 'От загрузки до готового документа — четыре шага.',
      en: 'From upload to final document in four steps.', de: 'Vom Upload zum fertigen Dokument – in vier Schritten.', ar: 'من رفع الملف إلى المستند الجاهز — أربع خطوات.', kk: 'Жүктеуден дайын құжатқа дейін — төрт қадам.', uz: 'Yuklashdan tayyor hujjatgacha — toʻrt qadam.',
    },
  },
  demo: {
    eyebrow: { ru: 'Демо', en: 'Demo', de: 'Demo', ar: 'عرض توضيحي', kk: 'Демо', uz: 'Demo' },
    title: { ru: 'Так выглядит анализ', en: 'What a review looks like', de: 'So sieht eine Analyse aus', ar: 'هكذا يبدو التحليل', kk: 'Талдау осылай көрінеді', uz: 'Tahlil shunday koʻrinadi' },
    sub: {
      ru: 'Пример того, что вы получаете по каждому рискованному пункту.',
      en: 'An example of what you get for every risky clause.', de: 'Ein Beispiel dafür, was Sie zu jeder riskanten Klausel erhalten.', ar: 'مثال على ما تحصل عليه لكل بند ينطوي على مخاطر.', kk: 'Әр тәуекелді тармақ бойынша не алатыныңыздың мысалы.', uz: 'Har bir xavfli band boʻyicha nima olishingizni koʻrsatuvchi namuna.',
    },
  },
  solutions: {
    eyebrow: { ru: 'Для кого', en: 'Who it’s for', de: 'Für wen', ar: 'الفئات المستفيدة', kk: 'Кімге арналған', uz: 'Kimlar uchun' },
    title: { ru: 'Кому полезен Lexab', en: 'Who Lexab helps', de: 'Wem Lexab hilft', ar: 'من يستفيد من Lexab', kk: 'Lexab кімге пайдалы', uz: 'Lexab kimlarga foydali' },
    sub: {
      ru: 'От юрфирм до частных лиц — везде, где договоры отнимают время.',
      en: 'From law firms to individuals — wherever contracts eat time.', de: 'Von Kanzleien bis zu Privatpersonen – überall dort, wo Verträge Zeit kosten.', ar: 'من مكاتب المحاماة إلى الأفراد — أينما كانت العقود تستهلك الوقت.', kk: 'Заң фирмаларынан жеке тұлғаларға дейін — шарттар уақыт алатын барлық жерде.', uz: 'Yuridik firmalardan jismoniy shaxslargacha — shartnomalar vaqtni olayotgan har qanday joyda.',
    },
  },
  security: {
    eyebrow: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
    title: { ru: 'Ваши документы — под вашим контролем', en: 'Your documents, under your control', de: 'Ihre Dokumente – unter Ihrer Kontrolle', ar: 'مستنداتك تحت سيطرتك', kk: 'Құжаттарыңыз — өз бақылауыңызда', uz: 'Hujjatlaringiz — oʻz nazoratingizda' },
    sub: {
      ru: 'Для юридического продукта это не опция. Вот как Lexab обращается с данными — честно и по делу.',
      en: 'For a legal product this isn’t optional. Here is how Lexab handles your data — plainly and honestly.', de: 'Für ein juristisches Produkt ist das nicht optional. So geht Lexab mit Ihren Daten um – ehrlich und auf den Punkt.', ar: 'بالنسبة إلى منتج قانوني، هذا ليس خياراً إضافياً. إليك كيف يتعامل Lexab مع البيانات — بصراحة ووضوح.', kk: 'Заң өнімі үшін бұл — таңдау емес, міндет. Міне, Lexab деректеріңізбен қалай жұмыс істейді — адал әрі нақты.', uz: 'Yuridik mahsulot uchun bu qoʻshimcha imkoniyat emas, zarurat. Mana, Lexab maʼlumotlar bilan qanday ishlaydi — halol va ochiq.',
    },
  },
  plans: {
    eyebrow: { ru: 'Тарифы', en: 'Pricing', de: 'Preise', ar: 'الأسعار', kk: 'Тарифтер', uz: 'Tariflar' },
    title: { ru: 'Планы под ваш объём работы', en: 'Plans for your workload', de: 'Tarife für Ihr Arbeitsvolumen', ar: 'باقات تناسب حجم عملك', kk: 'Жұмыс көлеміңізге сай жоспарлар', uz: 'Ish hajmingizga mos tariflar' },
    sub: {
      ru: 'Начните бесплатно — карта не нужна. При годовой оплате — скидка 15%.',
      en: 'Start free — no card required. Annual billing saves 15%.', de: 'Starten Sie kostenlos – ohne Kreditkarte. Bei jährlicher Zahlung sparen Sie 15 %.', ar: 'ابدأ مجاناً — لا حاجة إلى بطاقة. وعند الدفع السنوي خصم 15%.', kk: 'Тегін бастаңыз — карта қажет емес. Жылдық төлемде — 15% жеңілдік.', uz: 'Bepul boshlang — karta shart emas. Yillik toʻlovda — 15% chegirma.',
    },
  },
  faq: {
    eyebrow: { ru: 'FAQ', en: 'FAQ', de: 'FAQ', ar: 'الأسئلة الشائعة', kk: 'FAQ', uz: 'FAQ' },
    title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'الأسئلة المتكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
    sub: {
      ru: 'Коротко и честно — о безопасности, анализе и старте.',
      en: 'Short, honest answers about security, analysis and getting started.', de: 'Kurz und ehrlich – zu Sicherheit, Analyse und dem Einstieg.', ar: 'إجابات موجزة وصادقة عن الأمان والتحليل وبدء الاستخدام.', kk: 'Қауіпсіздік, талдау және бастау туралы — қысқаша әрі адал.', uz: 'Xavfsizlik, tahlil va ishni boshlash haqida — qisqa va halol javoblar.',
    },
  },
};

const FEATURES: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'docs',
    title: { ru: 'Анализ рисков', en: 'Risk analysis', de: 'Risikoanalyse' },
    text: {
      ru: 'Lexab читает договор целиком, находит опасные формулировки и объясняет, чем именно они грозят.',
      en: 'Lexab reads the entire contract, finds dangerous wording and explains exactly what it threatens.',
      de: 'Lexab liest den gesamten Vertrag, findet gefährliche Formulierungen und erklärt, was genau sie bedeuten.',
    },
  },
  {
    icon: 'esign',
    title: { ru: 'Правки и редлайн', en: 'Redlines and edits', de: 'Änderungen und Redline' },
    text: {
      ru: 'Готовые формулировки правок в вашем стиле — остаётся принять или отклонить изменения.',
      en: 'Ready-made edit wording in your style — just accept or reject the changes.',
      de: 'Fertige Formulierungen im eigenen Stil – Änderungen nur annehmen oder ablehnen.',
    },
  },
  {
    icon: 'message',
    title: { ru: 'Вопросы к документу', en: 'Questions to the document', de: 'Fragen an das Dokument' },
    text: {
      ru: 'Спросите про сроки, штрафы или ответственность — ответ придёт со ссылкой на пункт договора.',
      en: 'Ask about deadlines, penalties or liability — the answer comes with a link to the contract clause.',
      de: 'Fragen Sie nach Fristen, Strafen oder Haftung – die Antwort verweist auf die Vertragsklausel.',
    },
  },
  {
    icon: 'check',
    title: { ru: 'Проверка цитат', en: 'Citation checking', de: 'Zitatprüfung' },
    text: {
      ru: 'Каждая ссылка на закон сверяется с базой официальных текстов, прежде чем попасть в ответ.',
      en: 'Every legal citation is checked against the base of official texts before it reaches the answer.',
      de: 'Jeder Gesetzesverweis wird vor der Antwort mit den offiziellen Texten abgeglichen.',
    },
  },
];

const STEPS: { title: Text2; text: Text2 }[] = [
  {
    title: { ru: 'Загрузите договор', en: 'Upload your contract', de: 'Laden Sie Ihren Vertrag hoch', ar: 'ارفع عقدك', kk: 'Шартты жүктеңіз', uz: 'Shartnomani yuklang' },
    text: {
      ru: 'Или вставьте текст прямо в чат — Lexab работает с вашими документами.',
      en: 'Or paste the text straight into the chat — Lexab works with your documents.', de: 'Oder fügen Sie den Text direkt in den Chat ein – Lexab arbeitet mit Ihren Dokumenten.', ar: 'أو الصق النص مباشرة في المحادثة — يعمل Lexab مع مستنداتك.', kk: 'Немесе мәтінді тікелей чатқа қойыңыз — Lexab сіздің құжаттарыңызбен жұмыс істейді.', uz: 'Yoki matnni toʻgʻridan-toʻgʻri chatga joylashtiring — Lexab sizning hujjatlaringiz bilan ishlaydi.',
    },
  },
  {
    title: { ru: 'ИИ находит риски', en: 'The AI finds risks', de: 'Die KI findet die Risiken', ar: 'يكتشف الذكاء الاصطناعي المخاطر', kk: 'ЖИ тәуекелдерді табады', uz: 'AI xavflarni topadi' },
    text: {
      ru: 'Разбор по пунктам: что опасно, почему и насколько это серьёзно.',
      en: 'A clause-by-clause breakdown: what is risky, why, and how serious it is.', de: 'Eine Analyse Klausel für Klausel: was riskant ist, warum – und wie schwerwiegend.', ar: 'تحليل بنداً بنداً: ما الخطر، ولماذا، وما مدى جسامته.', kk: 'Тармақ бойынша талдау: не қауіпті, неліктен және бұл қаншалықты елеулі.', uz: 'Band-band tahlil: nima xavfli, nega va bu qanchalik jiddiy.',
    },
  },
  {
    title: { ru: 'Проверяете цитаты', en: 'Verify the citations', de: 'Sie prüfen die Zitate', ar: 'تحقّق من الاستشهادات', kk: 'Дәйексөздерді тексересіз', uz: 'Iqtiboslarni tekshirasiz' },
    text: {
      ru: 'Каждый вывод — со ссылкой на норму закона, которую можно открыть и проверить.',
      en: 'Every finding cites a legal provision you can open and check yourself.', de: 'Jedes Ergebnis verweist auf eine konkrete Rechtsnorm, die Sie öffnen und selbst überprüfen können.', ar: 'كل استنتاج مصحوب بإحالة إلى نص قانوني يمكنك فتحه والتحقق منه بنفسك.', kk: 'Әр тұжырым — ашып тексеруге болатын заң нормасына сілтемемен беріледі.', uz: 'Har bir xulosa — ochib, oʻzingiz tekshirishingiz mumkin boʻlgan qonun normasiga havola bilan.',
    },
  },
  {
    title: { ru: 'Принимаете правки', en: 'Accept the redlines', de: 'Sie übernehmen die Änderungen', ar: 'اعتمد التعديلات', kk: 'Түзетулерді қабылдайсыз', uz: 'Tahrirlarni qabul qilasiz' },
    text: {
      ru: 'Примите или отклоните предложенные правки и экспортируйте готовый документ.',
      en: 'Accept or reject the suggested edits and export the final document.', de: 'Nehmen Sie die vorgeschlagenen Änderungen an oder lehnen Sie sie ab – und exportieren Sie das fertige Dokument.', ar: 'اقبل التعديلات المقترحة أو ارفضها، ثم صدّر المستند النهائي.', kk: 'Ұсынылған түзетулерді қабылдап немесе қабылдамай, дайын құжатты экспорттаңыз.', uz: 'Taklif qilingan tahrirlarni qabul qiling yoki rad eting va tayyor hujjatni eksport qiling.',
    },
  },
];

/** Audience cards (photo-10 layout): an optional headline metric top-right,
 *  plus a "learn more" link. Metrics are product-positioning figures — the
 *  Individuals card intentionally carries none (no number to stand behind). */
const AUDIENCES: { title: Text2; text: Text2; points: Text2[] }[] = [
  {
    title: { ru: 'Юридические фирмы', en: 'Law firms', de: 'Kanzleien' },
    text: {
      ru: 'Больше договоров на юриста без потери качества проверки.',
      en: 'More contracts per lawyer without losing review quality.',
      de: 'Mehr Verträge pro Jurist – ohne Qualitätsverlust bei der Prüfung.',
    },
    points: [
      { ru: 'Due diligence в разы быстрее', en: 'Due diligence times faster', de: 'Due Diligence um ein Vielfaches schneller' },
      { ru: 'Единый стандарт правок', en: 'A single redline standard', de: 'Ein einheitlicher Redline-Standard' },
      { ru: 'Отчёты для клиентов', en: 'Reports for clients', de: 'Berichte für Mandanten' },
    ],
  },
  {
    title: { ru: 'Инхаус-команды', en: 'In-house teams', de: 'Inhouse-Teams' },
    text: {
      ru: 'Согласование договоров перестаёт быть узким местом бизнеса.',
      en: 'Contract approvals stop being the bottleneck of the business.',
      de: 'Vertragsfreigaben sind kein Engpass mehr für das Geschäft.',
    },
    points: [
      { ru: 'Очередь договоров под контролем', en: 'The contract queue under control', de: 'Die Vertragswarteschlange unter Kontrolle' },
      { ru: 'Типовые риски ловятся сразу', en: 'Standard risks are caught immediately', de: 'Typische Risiken werden sofort erkannt' },
      { ru: 'SSO и роли доступа', en: 'SSO and access roles', de: 'SSO und Zugriffsrollen' },
    ],
  },
  {
    title: { ru: 'Частная практика', en: 'Solo practice', de: 'Einzelpraxis' },
    text: {
      ru: 'Возможности большой команды — в руках одного юриста.',
      en: 'The capabilities of a big team — in the hands of one lawyer.',
      de: 'Die Möglichkeiten eines großen Teams – in der Hand eines einzelnen Juristen.',
    },
    points: [
      { ru: 'Быстрый разбор входящих документов', en: 'Fast triage of incoming documents', de: 'Schnelle Sichtung eingehender Dokumente' },
      { ru: 'Черновики правок за минуты', en: 'Draft redlines in minutes', de: 'Änderungsentwürfe in Minuten' },
      { ru: 'Оплата по мере роста', en: 'Pay as you grow', de: 'Bezahlen nach Wachstum' },
    ],
  },
];

/** Каждая карточка сверена с кодом продукта: AES-256-GCM шифрование документов
 *  (обязательный ключ), TLS к базе, отсутствие обучения у ИИ-провайдеров,
 *  ключ шифрования на каждый аккаунт, SSO/роли/журнал аудита. */
const SECURITY: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'lock',
    title: { ru: 'Шифрование', en: 'Encryption', de: 'Verschlüsselung' },
    text: {
      ru: 'Данные защищены при передаче и хранении — TLS 1.3 и AES-256.',
      en: 'Data is protected in transit and at rest — TLS 1.3 and AES-256.',
      de: 'Daten sind bei Übertragung und Speicherung geschützt – TLS 1.3 und AES-256.',
    },
  },
  {
    icon: 'eyeOff',
    title: { ru: 'Без обучения на ваших данных', en: 'No training on your data', de: 'Kein Training mit Ihren Daten' },
    text: {
      ru: 'Документы клиентов никогда не используются для обучения моделей.',
      en: 'Client documents are never used to train models.',
      de: 'Kundendokumente werden niemals zum Trainieren von Modellen verwendet.',
    },
  },
  {
    icon: 'server',
    title: { ru: 'Изоляция данных', en: 'Data isolation', de: 'Datenisolation' },
    text: {
      ru: 'Документы каждой организации шифруются собственным ключом и изолированы правами доступа.',
      en: 'Each organisation’s documents are encrypted with their own key and isolated by access rights.',
      de: 'Die Dokumente jeder Organisation werden mit eigenem Schlüssel verschlüsselt und über Zugriffsrechte isoliert.',
    },
  },
  {
    icon: 'key',
    title: { ru: 'Контроль доступа', en: 'Access control', de: 'Zugriffskontrolle' },
    text: {
      ru: 'SSO, роли и журнал действий — доступ только у тех, кому он нужен.',
      en: 'SSO, roles and an audit log — access only for those who need it.',
      de: 'SSO, Rollen und Aktivitätsprotokoll – Zugriff nur für jene, die ihn brauchen.',
    },
  },
];

interface LandingPlan {
  name: string;
  dot: string;
  /** Monthly price in USD; yearly billing shows it with the 15% discount. */
  monthly: number;
  /** Фактическая ГОДОВАЯ цена у платёжного провайдера, если она не равна
   *  monthly*12*(1−15%): у Lemon Squeezy потолок цены $5000 — годовой
   *  Business стоит ровно $5000 ($417/мес), а не расчётные $5088 ($424/мес).
   *  То же поле и та же формула — в PlansPage.tsx, иначе лендинг и страница
   *  тарифов показывают разные числа. */
  yearlyTotal?: number;
  popular?: boolean;
  tagline: Text2;
  /** "Everything in X, plus:" line shown above the feature list. */
  inherits?: Text2;
  features: Text2[];
}

/** Mirrors the in-app Plans page (PlansPage.tsx) — same taglines, features and
 *  gates — so the descriptions stay identical on the landing and inside the app. */
const YEARLY_DISCOUNT = 0.15;

/** Месячный эквивалент годовой цены: из фактической цены провайдера, если она
 *  задана (Business: $5000/год → $417/мес), иначе −15% от месячной.
 *  Копия расчёта из PlansPage.tsx — числа обязаны совпадать. */
function monthlyEqYearly(p: LandingPlan): number {
  return p.yearlyTotal !== undefined
    ? Math.round(p.yearlyTotal / 12)
    : Math.round(p.monthly * (1 - YEARLY_DISCOUNT));
}

const PLANS: LandingPlan[] = [
  {
    name: 'Free',
    dot: '#5F5F6A',
    monthly: 0,
    tagline: { ru: 'Узнайте, что Lexab может сделать для вас', en: 'See what Lexab can do for you', de: 'Erfahren Sie, was Lexab für Sie tun kann', ar: 'اكتشف ما يمكن أن يقدّمه لك Lexab', kk: 'Lexab сіз үшін не істей алатынын біліңіз', uz: 'Lexab siz uchun nimalar qila olishini bilib oling' },
    features: [
      { ru: '20 обращений к ИИ в месяц', en: '20 AI requests per month', de: '20 KI-Anfragen pro Monat', ar: '20 طلب ذكاء اصطناعي شهرياً', kk: 'Айына 20 AI-сұрау', uz: 'Oyiga 20 ta AI soʻrov' },
      { ru: 'До 3 документов', en: 'Up to 3 documents', de: 'Bis zu 3 Dokumente', ar: 'حتى 3 مستندات', kk: '3 құжатқа дейін', uz: '3 tagacha hujjat' },
      { ru: '100 МБ хранилища', en: '100 MB storage', de: '100 MB Speicherplatz', ar: '100 ميغابايت من التخزين', kk: '100 МБ қойма', uz: '100 MB xotira' },
      { ru: 'AI Chat с документами', en: 'AI Chat with documents', de: 'AI Chat mit Dokumenten', ar: 'محادثة AI Chat مع المستندات', kk: 'Құжаттармен AI Chat', uz: 'Hujjatlar bilan AI Chat' },
      { ru: 'AI Summary', en: 'AI Summary', de: 'AI Summary', ar: 'ملخص AI Summary', kk: 'AI Summary', uz: 'AI Summary' },
      { ru: 'Экспорт в PDF', en: 'PDF export', de: 'PDF-Export', ar: 'تصدير إلى PDF', kk: 'PDF форматына экспорт', uz: 'PDFga eksport' },
    ],
  },
  {
    name: 'Standard',
    dot: '#3FB8AF',
    monthly: 15,
    tagline: { ru: 'Для студентов, фрилансеров и стартапов', en: 'For students, freelancers and startups', de: 'Für Studierende, Freelancer und Start-ups', ar: 'للطلاب والمستقلين والشركات الناشئة', kk: 'Студенттерге, фрилансерлерге және стартаптарға арналған', uz: 'Talabalar, frilanserlar va startaplar uchun' },
    features: [
      { ru: 'До 100 AI-запросов в месяц', en: 'Up to 100 AI requests per month', de: 'Bis zu 100 KI-Anfragen pro Monat', ar: 'حتى 100 طلب ذكاء اصطناعي شهرياً', kk: 'Айына 100 AI-сұрауға дейін', uz: 'Oyiga 100 tagacha AI soʻrov' },
      { ru: 'До 20 документов в месяц', en: 'Up to 20 documents per month', de: 'Bis zu 20 Dokumente pro Monat', ar: 'حتى 20 مستنداً شهرياً', kk: 'Айына 20 құжатқа дейін', uz: 'Oyiga 20 tagacha hujjat' },
      { ru: 'AI Chat с документами', en: 'AI Chat with documents', de: 'AI Chat mit Dokumenten', ar: 'محادثة AI Chat مع المستندات', kk: 'Құжаттармен AI Chat', uz: 'Hujjatlar bilan AI Chat' },
      { ru: 'AI Contract Generator', en: 'AI Contract Generator', de: 'AI Contract Generator', ar: 'مولّد العقود AI Contract Generator', kk: 'AI Contract Generator', uz: 'AI Contract Generator' },
      { ru: 'AI Summary', en: 'AI Summary', de: 'AI Summary', ar: 'ملخص AI Summary', kk: 'AI Summary', uz: 'AI Summary' },
      { ru: 'Экспорт в PDF и DOCX', en: 'PDF & DOCX export', de: 'Export als PDF und DOCX', ar: 'تصدير إلى PDF وDOCX', kk: 'PDF және DOCX форматына экспорт', uz: 'PDF va DOCXga eksport' },
      { ru: '2 GB защищённого хранилища', en: '2 GB secure storage', de: '2 GB geschützter Speicherplatz', ar: '‏2 GB من التخزين الآمن', kk: '2 GB қорғалған қойма', uz: '2 GB himoyalangan xotira' },
      { ru: 'Email-поддержка', en: 'Email support', de: 'E-Mail-Support', ar: 'دعم عبر البريد الإلكتروني', kk: 'Email арқылы қолдау', uz: 'Email orqali qoʻllab-quvvatlash' },
    ],
  },
  {
    name: 'Pro',
    dot: '#5B8DEF',
    monthly: 50,
    popular: true,
    tagline: { ru: 'Для юристов и малого бизнеса', en: 'For lawyers and small businesses', de: 'Für Juristen und kleine Unternehmen', ar: 'للمحامين والأعمال الصغيرة', kk: 'Заңгерлер мен шағын бизнеске арналған', uz: 'Yuristlar va kichik biznes uchun' },
    inherits: { ru: 'Всё из Standard, плюс:', en: 'Everything in Standard, plus:', de: 'Alles aus Standard, plus:', ar: 'كل ما في Standard، بالإضافة إلى:', kk: 'Standard тарифіндегінің бәрі, оған қоса:', uz: 'Standard tarifidagi hammasi, qoʻshimcha:' },
    features: [
      { ru: 'До 500 обращений к ИИ в месяц', en: 'Up to 500 AI requests per month', de: 'Bis zu 500 KI-Anfragen pro Monat', ar: 'حتى 500 طلب ذكاء اصطناعي شهرياً', kk: 'Айына 500 AI-сұрауға дейін', uz: 'Oyiga 500 tagacha AI soʻrov' },
      { ru: 'До 80 документов в месяц', en: 'Up to 80 documents per month', de: 'Bis zu 80 Dokumente pro Monat', ar: 'حتى 80 مستنداً شهرياً', kk: 'Айына 80 құжатқа дейін', uz: 'Oyiga 80 tagacha hujjat' },
      { ru: 'Redline (сравнение версий)', en: 'Redline (version compare)', de: 'Redline (Versionsvergleich)', ar: 'Redline (مقارنة الإصدارات)', kk: 'Redline (нұсқаларды салыстыру)', uz: 'Redline (versiyalarni solishtirish)' },
      { ru: 'Version History', en: 'Version History', de: 'Version History', ar: 'سجل الإصدارات (Version History)', kk: 'Version History', uz: 'Version History' },
      { ru: 'Маршруты согласования (цепочки утверждения с дедлайнами)', en: 'Approval workflows (multi-step sign-off with deadlines)', de: 'Freigabe-Workflows (mehrstufige Genehmigungsketten mit Fristen)', ar: 'مسارات الموافقة (سلاسل اعتماد متعددة الخطوات بمواعيد نهائية)', kk: 'Келісу маршруттары (дедлайндары бар бекіту тізбектері)', uz: 'Kelishuv marshrutlari (muddatlar bilan tasdiqlash zanjirlari)' },
      { ru: 'Правила по пунктам (плейбуки)', en: 'Clause playbooks', de: 'Klausel-Playbooks', ar: 'أدلة البنود (Playbooks)', kk: 'Тармақтар бойынша ережелер (плейбуктер)', uz: 'Bandlar boʻyicha qoidalar (pleybuklar)' },
      { ru: 'Пакетная проверка договоров', en: 'Bulk contract review', de: 'Stapelprüfung von Verträgen', ar: 'مراجعة العقود دفعةً واحدة', kk: 'Шарттарды топтап тексеру', uz: 'Shartnomalarni paketli tekshirish' },
      { ru: 'Обязательства и сроки по договору (CLM)', en: 'Contract obligations and deadlines (CLM)', de: 'Vertragspflichten und Fristen (CLM)', ar: 'الالتزامات والمواعيد التعاقدية (CLM)', kk: 'Шарт бойынша міндеттемелер мен мерзімдер (CLM)', uz: 'Shartnoma boʻyicha majburiyatlar va muddatlar (CLM)' },
      { ru: 'Сценарии обработки', en: 'Processing workflows', de: 'Verarbeitungs-Workflows', ar: 'سيناريوهات المعالجة', kk: 'Өңдеу сценарийлері', uz: 'Ishlov berish stsenariylari' },
      { ru: '50 GB защищённого хранилища', en: '50 GB secure storage', de: '50 GB geschützter Speicherplatz', ar: '‏50 GB من التخزين الآمن', kk: '50 GB қорғалған қойма', uz: '50 GB himoyalangan xotira' },
      { ru: 'Приоритетная поддержка', en: 'Priority support', de: 'Priorisierter Support', ar: 'دعم ذو أولوية', kk: 'Приоритетті қолдау', uz: 'Ustuvor qoʻllab-quvvatlash' },
      { ru: 'Ранний доступ к новым функциям', en: 'Early access to new features', de: 'Früher Zugriff auf neue Funktionen', ar: 'وصول مبكر إلى الميزات الجديدة', kk: 'Жаңа функцияларға ерте қол жеткізу', uz: 'Yangi funksiyalarga erta kirish' },
    ],
  },
  {
    name: 'Business',
    dot: '#8B7CF6',
    monthly: 499,
    yearlyTotal: 5000,
    tagline: { ru: 'Для юридических фирм и компаний', en: 'For law firms and companies', de: 'Für Kanzleien und Unternehmen', ar: 'لمكاتب المحاماة والشركات', kk: 'Заң фирмалары мен компанияларға арналған', uz: 'Yuridik firmalar va kompaniyalar uchun' },
    inherits: { ru: 'Всё из Pro, плюс:', en: 'Everything in Pro, plus:', de: 'Alles aus Pro, plus:', ar: 'كل ما في Pro، بالإضافة إلى:', kk: 'Pro тарифіндегінің бәрі, оған қоса:', uz: 'Pro tarifidagi hammasi, qoʻshimcha:' },
    features: [
      { ru: 'Доступ к самым мощным AI-моделям', en: 'Access to the most capable AI models', de: 'Zugriff auf die leistungsstärksten KI-Modelle', ar: 'الوصول إلى أقوى نماذج الذكاء الاصطناعي', kk: 'Ең қуатты AI-модельдерге қол жеткізу', uz: 'Eng kuchli AI modellaridan foydalanish' },
      { ru: '5 приглашённых участников плюс владелец', en: '5 invited members plus the owner', de: '5 eingeladene Mitglieder plus Inhaber', ar: '5 أعضاء مدعوين إضافةً إلى المالك', kk: '5 шақырылған қатысушы және иесі', uz: '5 ta taklif qilingan ishtirokchi va egasi' },
      { ru: 'До 700 документов в месяц', en: 'Up to 700 documents per month', de: 'Bis zu 700 Dokumente pro Monat', ar: 'حتى 700 مستند شهرياً', kk: 'Айына 700 құжатқа дейін', uz: 'Oyiga 700 tagacha hujjat' },
      { ru: 'Общие Workspaces', en: 'Shared workspaces', de: 'Gemeinsame Workspaces', ar: 'مساحات عمل مشتركة (Workspaces)', kk: 'Ортақ Workspaces', uz: 'Umumiy Workspaces' },
      { ru: 'Управление ролями и правами доступа', en: 'Roles & access management', de: 'Rollen- und Rechteverwaltung', ar: 'إدارة الأدوار وصلاحيات الوصول', kk: 'Рөлдер мен қол жеткізу құқықтарын басқару', uz: 'Rollar va kirish huquqlarini boshqarish' },
      { ru: 'Совместная работа над документами', en: 'Document collaboration', de: 'Gemeinsames Arbeiten an Dokumenten', ar: 'العمل التعاوني على المستندات', kk: 'Құжаттармен бірлескен жұмыс', uz: 'Hujjatlar ustida hamkorlikda ishlash' },
      { ru: 'Audit Log', en: 'Audit log', de: 'Audit Log', ar: 'سجل التدقيق (Audit Log)', kk: 'Audit Log', uz: 'Audit Log' },
      // 1000 — config.apiMonthlyLimit (server/src/config.ts:203, переменная
      // API_MONTHLY_LIMIT не задана → действует значение по умолчанию).
      // У Enterprise потолка запросов к API нет (apiMonthlyLimitFor → null).
      { ru: 'Программный доступ по API (1000 запросов в месяц)', en: 'Programmatic API access (1,000 requests/mo)', de: 'Programmatischer API-Zugang (1.000 Anfragen/Mon.)', ar: 'وصول برمجي عبر API (1000 طلب شهريًا)', kk: 'API арқылы бағдарламалық қолжетімділік (айына 1000 сұрау)', uz: 'API orqali dasturiy kirish (oyiga 1000 soʻrov)' },
      { ru: 'SSO (Single Sign-On)', en: 'SSO (Single Sign-On)', de: 'SSO (Single Sign-On)', ar: 'SSO (تسجيل الدخول الموحّد)', kk: 'SSO (Single Sign-On)', uz: 'SSO (Single Sign-On)' },
      { ru: '1 TB защищённого хранилища', en: '1 TB secure storage', de: '1 TB geschützter Speicherplatz', ar: '‏1 TB من التخزين الآمن', kk: '1 TB қорғалған қойма', uz: '1 TB himoyalangan xotira' },
      { ru: 'Выделенный Customer Success Manager', en: 'Dedicated Customer Success Manager', de: 'Dedizierter Customer Success Manager', ar: 'مدير مخصص لنجاح العملاء (Customer Success Manager)', kk: 'Арнайы бекітілген Customer Success Manager', uz: 'Shaxsiy Customer Success Manager' },
    ],
  },
];

/** Enterprise — custom pricing, shown as a full-width card below the grid
 *  (mirrors the in-app Enterprise card). */
const ENTERPRISE: { dot: string; priceLabel: Text2; tagline: Text2; features: Text2[] } = {
  dot: '#9A9AA6',
  priceLabel: { ru: 'По договорённости', en: 'Custom pricing', de: 'Auf Anfrage', ar: 'حسب الاتفاق', kk: 'Келісім бойынша', uz: 'Kelishuv asosida' },
  tagline: { ru: 'Индивидуальные условия и внедрение — по созвону.', en: 'Custom terms and onboarding — book a call.', de: 'Individuelle Konditionen und Onboarding – vereinbaren Sie ein Gespräch.', ar: 'شروط وتهيئة مخصصة — عبر مكالمة معنا.', kk: 'Жеке шарттар мен енгізу — қоңырау арқылы келісіледі.', uz: 'Individual shartlar va joriy etish — qoʻngʻiroqda kelishamiz.' },
  features: [
    { ru: 'Безлимитные пользователи и документы', en: 'Unlimited users and documents', de: 'Unbegrenzte Nutzer und Dokumente', ar: 'عدد غير محدود من المستخدمين والمستندات', kk: 'Шексіз пайдаланушылар мен құжаттар', uz: 'Cheklanmagan foydalanuvchilar va hujjatlar' },
    { ru: 'Приватные / self-hosted AI-модели', en: 'Private / self-hosted AI models', de: 'Private / self-hosted KI-Modelle', ar: 'نماذج ذكاء اصطناعي خاصة أو مستضافة ذاتياً', kk: 'Жеке / self-hosted AI-модельдер', uz: 'Privat / self-hosted AI modellar' },
    { ru: 'Кастомные интеграции и API', en: 'Custom integrations and API', de: 'Individuelle Integrationen und API', ar: 'تكاملات مخصصة وواجهات API', kk: 'Арнайы интеграциялар және API', uz: 'Maxsus integratsiyalar va API' },
    { ru: 'Персональный SLA и поддержка 24/7', en: 'Personal SLA and 24/7 support', de: 'Individuelles SLA und 24/7-Support', ar: 'اتفاقية مستوى خدمة (SLA) مخصصة ودعم على مدار الساعة 24/7', kk: 'Жеке SLA және 24/7 қолдау', uz: 'Shaxsiy SLA va 24/7 qoʻllab-quvvatlash' },
    { ru: 'Юридический on-boarding команды', en: 'Legal onboarding for your team', de: 'Juristisches Onboarding für Ihr Team', ar: 'تأهيل قانوني لفريقك', kk: 'Командаға арналған заңгерлік онбординг', uz: 'Jamoa uchun yuridik onboarding' },
  ],
};

interface FaqItem {
  q: Text2;
  a: Text2;
  /** Optional in-page link rendered under the answer. */
  link?: { id: string; label: Text2 };
}

const FAQ_GROUPS: { title: Text2; items: FaqItem[] }[] = [
  {
    title: { ru: 'Безопасность и конфиденциальность', en: 'Security & privacy', de: 'Sicherheit und Vertraulichkeit', ar: 'الأمان والخصوصية', kk: 'Қауіпсіздік және құпиялылық', uz: 'Xavfsizlik va maxfiylik' },
    items: [
      {
        q: { ru: 'Что происходит с моими договорами после загрузки?', en: 'What happens to my contracts after upload?', de: 'Was passiert mit meinen Verträgen nach dem Hochladen?', ar: 'ماذا يحدث لعقودي بعد رفعها؟', kk: 'Жүктегеннен кейін шарттарыма не болады?', uz: 'Yuklangandan keyin shartnomalarim bilan nima boʻladi?' },
        a: {
          ru: 'Файл сохраняется в приватном облачном хранилище (доступ — только по временным подписанным ссылкам), извлечённый текст — в защищённой базе данных. Документ используется только для анализа по вашему запросу. Удалить его — или весь аккаунт со всеми данными — можно в любой момент.',
          en: 'The file is stored in a private cloud bucket (accessible only via expiring signed links) and the extracted text in a protected database. It is used only for the analysis you request. You can delete a document — or your whole account with all its data — at any time.', de: 'Die Datei wird in einem privaten Cloud-Speicher abgelegt (Zugriff nur über zeitlich begrenzte signierte Links), der extrahierte Text in einer geschützten Datenbank. Das Dokument wird ausschließlich für die von Ihnen angeforderte Analyse verwendet. Sie können es – oder Ihr gesamtes Konto mit allen Daten – jederzeit löschen.', ar: 'يُحفظ الملف في مساحة تخزين سحابية خاصة (لا يمكن الوصول إليها إلا عبر روابط موقّعة مؤقتة)، ويُحفظ النص المستخرج في قاعدة بيانات محمية. ولا يُستخدم المستند إلا للتحليل الذي تطلبه أنت. ويمكنك في أي وقت حذف المستند — أو الحساب بأكمله مع جميع بياناته.', kk: 'Файл жеке бұлттық қоймада сақталады (қол жеткізу — тек мерзімі шектеулі қол қойылған сілтемелер арқылы), ал алынған мәтін — қорғалған дерекқорда. Құжат тек сіздің сұрауыңыз бойынша талдау үшін ғана пайдаланылады. Құжатты — немесе барлық деректерімен қоса бүкіл аккаунтты — кез келген сәтте жоюға болады.', uz: 'Fayl yopiq bulut xotirasida saqlanadi (kirish — faqat muddati cheklangan imzolangan havolalar orqali), ajratib olingan matn esa himoyalangan maʼlumotlar bazasida turadi. Hujjat faqat sizning soʻrovingiz boʻyicha tahlil uchun ishlatiladi. Uni — yoki butun akkauntni barcha maʼlumotlari bilan — istalgan payt oʻchirish mumkin.',
        },
      },
      {
        q: { ru: 'Вы используете мои документы для обучения ИИ?', en: 'Do you use my documents to train the AI?', de: 'Verwenden Sie meine Dokumente zum Trainieren der KI?', ar: 'هل تستخدمون مستنداتي لتدريب الذكاء الاصطناعي؟', kk: 'Менің құжаттарым ЖИ-ді оқытуға пайдаланыла ма?', uz: 'Hujjatlarimni AIni oʻqitish uchun ishlatasizmi?' },
        a: {
          ru: 'Нет. Документы не используются для обучения моделей. Для самого анализа текст передаётся провайдеру модели (Anthropic; на бесплатном тарифе — DeepSeek), который обрабатывает его по договору и не обучается на нём. Больше никому документы не передаются — подробности в Политике конфиденциальности.',
          en: 'No. Your documents are not used for model training. To run the analysis itself the text is sent to the model provider (Anthropic; DeepSeek on the free plan), which processes it under contract and does not train on it. Nobody else receives your documents — see the Privacy Policy for details.', de: 'Nein. Ihre Dokumente werden nicht zum Trainieren von Modellen verwendet. Für die Analyse selbst wird der Text an den Modellanbieter übermittelt (Anthropic; im kostenlosen Tarif DeepSeek), der ihn vertraglich gebunden verarbeitet und nicht darauf trainiert. Sonst erhält niemand Ihre Dokumente — Details in der Datenschutzerklärung.', ar: 'لا. لا تُستخدم مستنداتك لتدريب النماذج. ولإجراء التحليل نفسه يُرسل النص إلى مزوّد النموذج (Anthropic؛ وفي الباقة المجانية DeepSeek) الذي يعالجه بموجب عقد ولا يتدرّب عليه. ولا يتلقّى مستنداتِك أحد سواه — التفاصيل في سياسة الخصوصية.', kk: 'Жоқ. Құжаттар модельдерді оқытуға пайдаланылмайды. Талдаудың өзі үшін мәтін модель провайдеріне (Anthropic; тегін тарифте — DeepSeek) беріледі, ол оны шарт бойынша өңдейді және оған үйретілмейді. Басқа ешкімге құжаттар берілмейді — егжей-тегжейі Құпиялылық саясатында.', uz: 'Yoʻq. Hujjatlar modellarni oʻqitish uchun ishlatilmaydi. Tahlilning oʻzi uchun matn model provayderiga (Anthropic; bepul tarifda — DeepSeek) yuboriladi, u shartnoma asosida qayta ishlaydi va unga oʻrgatilmaydi. Boshqa hech kimga hujjatlar berilmaydi — tafsilotlar Maxfiylik siyosatida.',
        },
      },
      {
        q: { ru: 'Кто может видеть мои документы?', en: 'Who can see my documents?', de: 'Wer kann meine Dokumente sehen?', ar: 'من يستطيع رؤية مستنداتي؟', kk: 'Менің құжаттарымды кім көре алады?', uz: 'Hujjatlarimni kim koʻra oladi?' },
        a: {
          ru: 'Только вы. На тарифе Business документ можно открыть своей команде: вы сами приглашаете коллег и назначаете роли — администратор, редактор или просмотр. Без вашего решения документ не увидит никто.',
          en: 'Only you. On the Business plan you can share a document with your team: you invite colleagues yourself and assign roles — admin, editor or viewer. Nobody sees a document unless you decide so.', de: 'Nur Sie. Im Business-Tarif können Sie ein Dokument für Ihr Team freigeben: Sie laden Ihre Kollegen selbst ein und vergeben die Rollen – Administrator, Bearbeiter oder Betrachter. Ohne Ihre Entscheidung sieht niemand das Dokument.', ar: 'أنت فقط. وعلى باقة Business يمكنك مشاركة المستند مع فريقك: أنت من يدعو الزملاء ويعيّن الأدوار — مسؤول أو محرر أو عارض. ولن يرى أحد المستند من دون قرارك.', kk: 'Тек өзіңіз. Business тарифінде құжатты командаңызға ашуға болады: әріптестерді өзіңіз шақырып, рөлдерді тағайындайсыз — әкімші, редактор немесе қарау. Сіздің шешіміңізсіз құжатты ешкім көрмейді.', uz: 'Faqat siz. Business tarifida hujjatni jamoangizga ochish mumkin: hamkasblarni oʻzingiz taklif qilasiz va rollarni tayinlaysiz — administrator, muharrir yoki koʻruvchi. Sizning qaroringizsiz hujjatni hech kim koʻrmaydi.',
        },
      },
    ],
  },
  {
    title: { ru: 'Как работает анализ', en: 'How the analysis works', de: 'Wie die Analyse funktioniert', ar: 'كيف يعمل التحليل', kk: 'Талдау қалай жұмыс істейді', uz: 'Tahlil qanday ishlaydi' },
    items: [
      {
        q: { ru: 'Можно ли доверять выводам ИИ? Он не ошибается?', en: 'Can I trust the AI’s conclusions? Doesn’t it make mistakes?', de: 'Kann ich den Ergebnissen der KI vertrauen? Macht sie keine Fehler?', ar: 'هل يمكن الوثوق باستنتاجات الذكاء الاصطناعي؟ ألا يخطئ؟', kk: 'ЖИ тұжырымдарына сенуге бола ма? Ол қателеспей ме?', uz: 'AI xulosalariga ishonsa boʻladimi? U xato qilmaydimi?' },
        a: {
          ru: 'Lexab не даёт «мнение из воздуха»: каждый вывод сопровождается ссылкой на конкретную норму, которую можно открыть и проверить самостоятельно. Цитаты автоматически сверяются с базой официальных текстов; не прошедшие проверку помечаются как неподтверждённые. ИИ — ускоритель работы, финальное решение всегда за юристом.',
          en: 'Lexab doesn’t give opinions out of thin air: every finding comes with a reference to a specific provision you can open and verify. Citations are automatically checked against a corpus of official texts; anything that fails the check is flagged as unverified. The AI speeds up the work — the final call is always the lawyer’s.', de: 'Lexab liefert keine Einschätzungen „aus dem Nichts“: Jedes Ergebnis wird von einem Verweis auf eine konkrete Rechtsnorm begleitet, die Sie öffnen und selbst überprüfen können. Die Zitate werden automatisch mit einer Datenbank offizieller Gesetzestexte abgeglichen; was die Prüfung nicht besteht, wird als unbestätigt gekennzeichnet. Die KI beschleunigt die Arbeit – die endgültige Entscheidung liegt immer beim Juristen.', ar: 'لا يُصدر Lexab آراءً من فراغ: فكل استنتاج مصحوب بإحالة إلى نص قانوني محدد يمكنك فتحه والتحقق منه بنفسك. وتُقارن الاستشهادات تلقائياً بقاعدة النصوص الرسمية، وما لا يجتاز التحقق يوسَم بأنه غير مؤكد. الذكاء الاصطناعي يسرّع العمل — أما القرار النهائي فيبقى دائماً للمحامي.', kk: 'Lexab ойдан пікір айтпайды: әр тұжырымға өзіңіз ашып тексере алатын нақты нормаға сілтеме қоса беріледі. Дәйексөздер ресми мәтіндер базасымен автоматты түрде салыстырылады; тексеруден өтпегендері расталмаған деп белгіленеді. ЖИ — жұмысты жеделдететін құрал, ал түпкілікті шешім әрқашан заңгердікі.', uz: 'Lexab «havodan olingan fikr» bermaydi: har bir xulosa aniq normaga havola bilan birga keladi — uni ochib, oʻzingiz tekshirishingiz mumkin. Iqtiboslar rasmiy matnlar bazasi bilan avtomatik solishtiriladi; tekshiruvdan oʻtmaganlari tasdiqlanmagan deb belgilanadi. AI — ishni tezlashtiruvchi vosita, yakuniy qaror esa har doim yuristda.',
        },
      },
      {
        q: { ru: 'Что значит «ссылки на законодательство»?', en: 'What do “legal citations” mean?', de: 'Was ist mit „Gesetzeszitaten“ gemeint?', ar: 'ما المقصود بـ«الاستشهادات بالتشريعات»؟', kk: '«Заңнамаға сілтемелер» деген нені білдіреді?', uz: '«Qonunchilikka havolalar» nimani anglatadi?' },
        a: {
          ru: 'Если система отмечает рискованный пункт, она показывает не просто «это плохо», а ссылку на статью закона, из-за которой пункт является рискованным. Тексты норм попадают в базу только из официальных государственных источников соответствующей юрисдикции, поэтому система не может «придумать» несуществующую норму, как обычный чат-бот.',
          en: 'When the system flags a risky clause, it doesn’t just say “this is bad” — it shows the specific statutory provision that makes the clause risky. Law texts enter the corpus only from official government sources for each jurisdiction, so the system cannot “invent” a non-existent provision the way a generic chatbot can.', de: 'Wenn das System eine riskante Klausel markiert, sagt es nicht bloß „das ist schlecht“, sondern zeigt die konkrete Gesetzesnorm, die die Klausel riskant macht. Gesetzestexte gelangen ausschließlich aus offiziellen staatlichen Quellen der jeweiligen Jurisdiktion in die Datenbank – das System kann daher keine nicht existierende Norm „erfinden“, wie es ein gewöhnlicher Chatbot tun kann.', ar: 'عندما يحدّد النظام بنداً ينطوي على مخاطر، فإنه لا يكتفي بالقول «هذا سيئ»، بل يعرض مادة القانون التي تجعل البند خطراً. ولا تدخل نصوص القوانين إلى القاعدة إلا من المصادر الحكومية الرسمية لكل ولاية قضائية، لذلك لا يستطيع النظام «اختلاق» نص قانوني لا وجود له كما تفعل روبوتات المحادثة العادية.', kk: 'Жүйе тәуекелді тармақты белгілегенде, жай ғана «бұл нашар» деп қоймайды — тармақты тәуекелді ететін нақты заң бабына сілтеме көрсетеді. Нормалардың мәтіндері базаға тек тиісті юрисдикцияның ресми мемлекеттік дереккөздерінен түседі, сондықтан жүйе қарапайым чат-бот сияқты жоқ норманы «ойлап шығара» алмайды.', uz: 'Tizim xavfli bandni belgilasa, u shunchaki «bu yomon» demaydi — bandni xavfli qilayotgan qonun moddasiga havolani koʻrsatadi. Norma matnlari bazaga faqat tegishli yurisdiksiyaning rasmiy davlat manbalaridan kiradi, shuning uchun tizim oddiy chat-bot kabi mavjud boʻlmagan normani «toʻqib chiqara» olmaydi.',
        },
      },
      {
        q: { ru: 'С законодательством каких стран вы работаете?', en: 'Which countries’ legislation do you cover?', de: 'Die Gesetzgebung welcher Länder decken Sie ab?', ar: 'ما الدول التي تغطون تشريعاتها؟', kk: 'Қай елдердің заңнамасымен жұмыс істейсіздер?', uz: 'Qaysi davlatlar qonunchiligi bilan ishlaysiz?' },
        a: {
          ru: 'Сейчас доступны семь юрисдикций: Великобритания, Узбекистан, Казахстан, Германия, ОАЭ, а также США и Канада с ограниченным охватом — по США загружены федеральные нормы (арбитраж, электронные подписи), по Канаде — Гражданский кодекс Квебека. Договорное право штатов США и общее право остальных провинций Канады пока не входят в базу. Новые юрисдикции подключаются как отдельные модули.',
          en: 'Seven jurisdictions are available today: the United Kingdom, Uzbekistan, Kazakhstan, Germany, the UAE, plus the United States and Canada with limited coverage — for the US we have loaded federal statutes (arbitration, e-signatures), for Canada the Civil Code of Québec. US state contract law and the common law of the other Canadian provinces are not in the corpus yet. New jurisdictions are added as separate modules.', de: 'Derzeit sind sieben Jurisdiktionen verfügbar: das Vereinigte Königreich, Usbekistan, Kasachstan, Deutschland, die VAE sowie die USA und Kanada mit eingeschränkter Abdeckung — für die USA sind Bundesnormen geladen (Schiedsverfahren, elektronische Signaturen), für Kanada das Zivilgesetzbuch von Québec. Das Vertragsrecht der US-Bundesstaaten und das Common Law der übrigen kanadischen Provinzen sind noch nicht im Korpus. Neue Jurisdiktionen werden als separate Module angebunden.', ar: 'تتوفر اليوم سبع ولايات قضائية: المملكة المتحدة وأوزبكستان وكازاخستان وألمانيا والإمارات، إضافةً إلى الولايات المتحدة وكندا بتغطية محدودة — فبالنسبة للولايات المتحدة حُمِّلت القوانين الفيدرالية (التحكيم والتوقيعات الإلكترونية)، وبالنسبة لكندا القانون المدني لكيبيك. أما قانون العقود في الولايات الأمريكية والقانون العام لبقية المقاطعات الكندية فليسا ضمن القاعدة بعد. وتُضاف الولايات القضائية الجديدة كوحدات مستقلة.', kk: 'Қазір жеті юрисдикция қолжетімді: Ұлыбритания, Өзбекстан, Қазақстан, Германия, БАӘ, сондай-ақ шектеулі қамтумен АҚШ пен Канада — АҚШ бойынша федералдық нормалар (төрелік, электрондық қолтаңба), Канада бойынша Квебектің Азаматтық кодексі жүктелген. АҚШ штаттарының шарттық құқығы мен Канаданың қалған провинцияларының жалпы құқығы әзірге базада жоқ. Жаңа юрисдикциялар жеке модульдер ретінде қосылады.', uz: 'Hozirda yettita yurisdiksiya mavjud: Buyuk Britaniya, Oʻzbekiston, Qozogʻiston, Germaniya, BAA, shuningdek cheklangan qamrov bilan AQSH va Kanada — AQSH boʻyicha federal normalar (arbitraj, elektron imzolar), Kanada boʻyicha Kvebek Fuqarolik kodeksi yuklangan. AQSH shtatlarining shartnoma huquqi va Kanadaning qolgan provinsiyalari umumiy huquqi hozircha bazada yoʻq. Yangi yurisdiksiyalar alohida modullar sifatida qoʻshiladi.',
        },
      },
      {
        q: { ru: 'Lexab заменяет юриста?', en: 'Does Lexab replace a lawyer?', de: 'Ersetzt Lexab den Juristen?', ar: 'هل يحل Lexab محل المحامي؟', kk: 'Lexab заңгерді алмастыра ма?', uz: 'Lexab yuristning oʻrnini bosadimi?' },
        a: {
          ru: 'Нет. Он берёт на себя рутину — вычитку, поиск рисков, редлайнинг, — чтобы юрист тратил время на решения, а не на перечитывание типовых пунктов.',
          en: 'No. It takes over the routine — proofreading, risk-spotting, redlining — so the lawyer spends time on decisions rather than re-reading boilerplate.', de: 'Nein. Lexab übernimmt die Routine – die Durchsicht, die Risikosuche, das Redlining –, damit Juristen ihre Zeit für Entscheidungen einsetzen statt für das erneute Lesen von Standardklauseln.', ar: 'لا. إنه يتولى الأعمال الروتينية — التدقيق واكتشاف المخاطر والتنقيح — ليصرف المحامي وقته في اتخاذ القرارات بدلاً من إعادة قراءة البنود النمطية.', kk: 'Жоқ. Ол күнделікті рутинаны — мәтінді түгендеуді, тәуекелдерді іздеуді, редлайнингті — өз мойнына алады, сөйтіп заңгер уақытын типтік тармақтарды қайта оқуға емес, шешімдерге жұмсайды.', uz: 'Yoʻq. U rutin ishlarni — sinchiklab oʻqish, xavflarni izlash, redlayningni — oʻz zimmasiga oladi; shunda yurist vaqtini tipik bandlarni qayta-qayta oʻqishga emas, qaror qabul qilishga sarflaydi.',
        },
      },
    ],
  },
  {
    title: { ru: 'Практика и старт', en: 'Getting started', de: 'Praxis und Einstieg', ar: 'البدء والاستخدام', kk: 'Практика және бастау', uz: 'Amaliyot va boshlash' },
    items: [
      {
        q: { ru: 'На каком языке работает система?', en: 'What languages does it work in?', de: 'In welchen Sprachen arbeitet das System?', ar: 'بأي لغة يعمل النظام؟', kk: 'Жүйе қай тілде жұмыс істейді?', uz: 'Tizim qaysi tilda ishlaydi?' },
        a: {
          ru: 'Интерфейс доступен на 6 языках: русском, английском, немецком, арабском, казахском и узбекском. ИИ отвечает на языке вашего вопроса. Корпус законов каждой юрисдикции хранится на её официальном языке публикации.',
          en: 'The interface is available in 6 languages: English, Russian, German, Arabic, Kazakh and Uzbek. The AI replies in the language of your question. Each jurisdiction’s law corpus is stored in its official language of publication.', de: 'Die Benutzeroberfläche ist in 6 Sprachen verfügbar: Deutsch, Englisch, Russisch, Arabisch, Kasachisch und Usbekisch. Die KI antwortet in der Sprache Ihrer Frage. Der Gesetzeskorpus jeder Jurisdiktion wird in ihrer offiziellen Veröffentlichungssprache gespeichert.', ar: 'الواجهة متوفرة بست لغات: العربية والإنجليزية والروسية والألمانية والكازاخية والأوزبكية، ويجيب الذكاء الاصطناعي بلغة سؤالك. أما مجموعة قوانين كل ولاية قضائية فتُحفظ بلغة نشرها الرسمية.', kk: 'Интерфейс 6 тілде қолжетімді: қазақ, орыс, ағылшын, неміс, араб және өзбек. ЖИ сұрағыңыздың тілінде жауап береді. Әр юрисдикцияның заңдар корпусы өзінің ресми жариялану тілінде сақталады.', uz: 'Interfeys 6 tilda mavjud: oʻzbek, rus, ingliz, nemis, arab va qozoq. AI savolingiz tilida javob beradi. Har bir yurisdiksiyaning qonunlar korpusi oʻzining rasmiy nashr tilida saqlanadi.',
        },
      },
      {
        q: { ru: 'Можно ли работать в привычном Word?', en: 'Can I keep working in Word?', de: 'Kann ich weiter im gewohnten Word arbeiten?', ar: 'هل يمكنني مواصلة العمل في Word كالمعتاد؟', kk: 'Үйреншікті Word-та жұмыс істей беруге бола ма?', uz: 'Odatiy Wordda ishlashda davom etsam boʻladimi?' },
        a: {
          ru: 'Да: документ с принятыми правками экспортируется в DOCX с сохранением форматирования и открывается в Word (есть и PDF). Отдельной надстройки внутри Word пока нет.',
          en: 'Yes: the document with accepted edits exports to DOCX with formatting preserved and opens in Word (PDF is available too). There is no in-Word add-in yet.', de: 'Ja: Das Dokument mit den angenommenen Änderungen wird als DOCX mit erhaltener Formatierung exportiert und öffnet sich in Word (PDF gibt es ebenfalls). Ein eigenes Add-in direkt in Word gibt es noch nicht.', ar: 'نعم: يُصدَّر المستند مع التعديلات المقبولة بصيغة DOCX مع الحفاظ على التنسيق ويفتح في Word (وتتوفر صيغة PDF أيضاً). ولا توجد حتى الآن إضافة مدمجة داخل Word.', kk: 'Иә: қабылданған түзетулері бар құжат пішімдеуі сақталған күйде DOCX форматына экспортталады және Word-та ашылады (PDF де бар). Word ішіндегі жеке қондырма әзірге жоқ.', uz: 'Ha: qabul qilingan tahrirlar kiritilgan hujjat formatlash saqlangan holda DOCXga eksport qilinadi va Wordda ochiladi (PDF ham bor). Word ichida ishlaydigan alohida plagin hozircha yoʻq.',
        },
      },
      {
        q: { ru: 'Как начать? Нужна ли карта?', en: 'How do I start? Do I need a card?', de: 'Wie starte ich? Brauche ich eine Kreditkarte?', ar: 'كيف أبدأ؟ وهل أحتاج إلى بطاقة؟', kk: 'Қалай бастауға болады? Карта қажет пе?', uz: 'Qanday boshlash mumkin? Karta kerakmi?' },
        a: {
          ru: 'Зарегистрируйтесь по email или через Google — тариф Free включает 20 обращений к ИИ и 3 документа в месяц. Банковская карта не нужна.',
          en: 'Sign up with email or Google — the Free plan includes 20 AI requests and 3 documents per month. No bank card required.', de: 'Registrieren Sie sich per E-Mail oder über Google – der Free-Tarif umfasst 20 KI-Anfragen und 3 Dokumente pro Monat. Eine Bankkarte ist nicht erforderlich.', ar: 'سجّل بالبريد الإلكتروني أو عبر Google — تتضمن باقة Free 20 طلب ذكاء اصطناعي و3 مستندات شهرياً. ولا حاجة إلى بطاقة بنكية.', kk: 'Email немесе Google арқылы тіркеліңіз — Free тарифіне айына 20 AI-сұрау мен 3 құжат кіреді. Банк картасы қажет емес.', uz: 'Email yoki Google orqali roʻyxatdan oʻting — Free tarifi oyiga 20 ta AI soʻrov va 3 ta hujjatni oʻz ichiga oladi. Bank kartasi kerak emas.',
        },
      },
      {
        q: { ru: 'Сколько это стоит?', en: 'How much does it cost?', de: 'Was kostet das?', ar: 'كم التكلفة؟', kk: 'Бұл қанша тұрады?', uz: 'Bu qancha turadi?' },
        a: {
          ru: 'Четыре тарифа под разный объём работы — от бесплатного до Business. При годовой оплате — скидка 15%.',
          en: 'Four plans for different workloads — from Free to Business. Annual billing comes with a 15% discount.', de: 'Vier Tarife für unterschiedliche Arbeitsvolumen – von Free bis Business. Bei jährlicher Zahlung erhalten Sie 15 % Rabatt.', ar: 'أربع باقات لأحجام عمل مختلفة — من Free المجانية إلى Business. وعند الدفع السنوي خصم 15%.', kk: 'Әртүрлі жұмыс көлеміне арналған төрт тариф — тегіннен Business-ке дейін. Жылдық төлемде — 15% жеңілдік.', uz: 'Turli ish hajmiga moʻljallangan toʻrtta tarif — bepul tarifdan Businessgacha. Yillik toʻlovda — 15% chegirma.',
        },
        link: { id: 'plans', label: { ru: 'Открыть тарифы', en: 'See pricing', de: 'Preise ansehen', ar: 'عرض الأسعار', kk: 'Тарифтерді ашу', uz: 'Tariflarni koʻrish' } },
      },
    ],
  },
];

/**
 * «Чего Lexab не делает» — блок стоит ВЫШЕ тарифов намеренно: юрист, увидевший
 * честный список границ до цены, читает цену с доверием. Каждый пункт — факт
 * из кода, а не осторожная оговорка (см. страницы /legal-base и /security).
 */
const NOT_DOING: { title: Text6; text: Text6 }[] = [
  {
    title: { ru: 'Не заменяет юриста', en: 'Does not replace a lawyer', de: 'Ersetzt keine Anwältin', ar: 'لا يحل محل المحامي', kk: 'Заңгерді алмастырмайды', uz: 'Yuristni almashtirmaydi' },
    text: {
      ru: 'Разбор и ссылка на норму — основание для вашего решения, а не решение. Отвечает тот, кто подписывает документ.',
      en: 'A review and a citation are grounds for your decision, not the decision. The person who signs the document answers for it.',
      de: 'Prüfung und Fundstelle sind Grundlage Ihrer Entscheidung, nicht die Entscheidung. Verantwortlich ist, wer unterschreibt.',
      ar: 'المراجعة والإحالة أساس لقرارك لا القرار نفسه. والمسؤول هو من يوقّع المستند.',
      kk: 'Талдау мен нормаға сілтеме — шешіміңіздің негізі, шешімнің өзі емес. Жауап беретін — құжатқа қол қоятын адам.',
      uz: 'Tahlil va normaga havola — qaroringiz uchun asos, qarorning oʻzi emas. Javob beradigan — hujjatga imzo chekadigan odam.',
    },
  },
  {
    title: { ru: 'Не ищет судебную практику', en: 'Does not search case law', de: 'Sucht keine Rechtsprechung', ar: 'لا يبحث في السوابق', kk: 'Сот практикасын іздемейді', uz: 'Sud amaliyotini qidirmaydi' },
    text: {
      ru: 'В корпусе только тексты законов с государственных порталов: судебных решений там нет вовсе.',
      en: 'The corpus holds only statutory texts from government portals: there are no court decisions in it at all.',
      de: 'Der Korpus enthält nur Gesetzestexte von staatlichen Portalen: Gerichtsentscheidungen gibt es dort gar nicht.',
      ar: 'تضم القاعدة نصوص القوانين من البوابات الحكومية فقط: ولا توجد فيها أحكام قضائية إطلاقًا.',
      kk: 'Корпуста тек мемлекеттік порталдардан алынған заң мәтіндері: сот шешімдері мүлде жоқ.',
      uz: 'Korpusda faqat davlat portallaridan olingan qonun matnlari: sud qarorlari umuman yoʻq.',
    },
  },
  {
    title: { ru: 'Не показывает редакцию на прошедшую дату', en: 'Shows no point-in-time version of the law', de: 'Zeigt keine Fassung zu einem Stichtag', ar: 'لا يعرض نسخة القانون بتاريخ سابق', kk: 'Өткен күнгі редакцияны көрсетпейді', uz: 'Oʻtgan sanadagi tahrirni koʻrsatmaydi' },
    text: {
      ru: 'Хранится снимок действующей редакции. Вопрос «как эта статья выглядела три года назад» пока без ответа.',
      en: 'A snapshot of the version in force is stored. “How did this article read three years ago” has no answer yet.',
      de: 'Gespeichert ist die geltende Fassung. „Wie lautete der Paragraf vor drei Jahren“ bleibt vorerst offen.',
      ar: 'تُخزَّن النسخة النافذة. وسؤال «كيف كانت هذه المادة قبل ثلاث سنوات» بلا إجابة بعد.',
      kk: 'Қолданыстағы редакцияның суреті сақталады. «Бұл бап үш жыл бұрын қалай еді» деген сұрақ әзірге жауапсыз.',
      uz: 'Amaldagi tahrir surati saqlanadi. «Bu modda uch yil oldin qanday edi» degan savol hozircha javobsiz.',
    },
  },
  {
    title: { ru: 'Не подписывает документы', en: 'Does not sign documents', de: 'Unterschreibt keine Dokumente', ar: 'لا يوقّع المستندات', kk: 'Құжаттарға қол қоймайды', uz: 'Hujjatlarga imzo chekmaydi' },
    text: {
      ru: 'Согласование внутри команды есть, а электронной подписи в продукте нет — подписывайте привычным способом.',
      en: 'Internal approvals exist, but there is no e-signature in the product — sign the way you normally do.',
      de: 'Interne Freigaben gibt es, eine elektronische Signatur nicht — unterschreiben Sie wie gewohnt.',
      ar: 'الموافقات الداخلية موجودة، أما التوقيع الإلكتروني فغير موجود — وقّع بطريقتك المعتادة.',
      kk: 'Команда ішінде келісу бар, ал электрондық қолтаңба өнімде жоқ — әдеттегі тәсілмен қол қойыңыз.',
      uz: 'Jamoa ichida kelishuv bor, elektron imzo esa mahsulotda yoʻq — odatdagi usulda imzolang.',
    },
  },
];

/** Footer columns: section anchors, verifiable sources, contacts, legal. */
const FOOTER_COLS: {
  title: Text2;
  links: { label: Text2; anchor?: string; href?: string; to?: string }[];
}[] = [
  {
    title: { ru: 'Продукт', en: 'Product', de: 'Produkt', ar: 'المنتج', kk: 'Өнім', uz: 'Mahsulot' },
    links: [
      { label: { ru: 'Возможности', en: 'Features', de: 'Funktionen', ar: 'المزايا', kk: 'Мүмкіндіктер', uz: 'Imkoniyatlar' }, anchor: 'features' },
      { label: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' }, anchor: 'how-it-works' },
      { label: { ru: 'Демо', en: 'Demo', de: 'Demo', ar: 'عرض توضيحي', kk: 'Демо', uz: 'Demo' }, anchor: 'demo' },
      { label: { ru: 'Тарифы', en: 'Pricing', de: 'Preise', ar: 'الأسعار', kk: 'Тарифтер', uz: 'Tariflar' }, anchor: 'plans' },
      { label: { ru: 'FAQ', en: 'FAQ', de: 'FAQ', ar: 'الأسئلة الشائعة', kk: 'FAQ', uz: 'FAQ' }, anchor: 'faq' },
    ],
  },
  {
    // Раньше в этой колонке была одна ссылка-якорь на секцию главной. Теперь —
    // подробные разделы сайта: из подвала главной в них попадают и человек,
    // и поисковый робот.
    //
    // Ссылки СТРОЯТСЯ ИЗ ОБЩЕГО МЕНЮ и фильтруются по реестру существующих
    // страниц — как и карта разделов выше. Первая версия была списком из пяти
    // литералов при таком же комментарии: аудит 06.08.2026 справедливо указал,
    // что комментарий описывал не то, что делает код.
    title: { ru: 'Разделы', en: 'Sections', de: 'Bereiche', ar: 'الأقسام', kk: 'Бөлімдер', uz: 'Boʻlimlar' },
    links: HEADER_NAV.flatMap((item) =>
      item.kind === 'route' && PUBLIC_SLUGS.includes(item.slug)
        ? [{ label: item.label, to: publicPath(item.slug) }]
        : [],
    ),
  },
  {
    title: { ru: 'Контакты', en: 'Contacts', de: 'Kontakt', ar: 'للتواصل', kk: 'Байланыс', uz: 'Aloqa' },
    links: [
      { label: { ru: 'Telegram · @MANAGER_CIVIS', en: 'Telegram · @MANAGER_CIVIS', de: 'Telegram · @MANAGER_CIVIS', ar: 'Telegram · @MANAGER_CIVIS', kk: 'Telegram · @MANAGER_CIVIS', uz: 'Telegram · @MANAGER_CIVIS' }, href: TELEGRAM_URL },
      { label: { ru: 'Enterprise — написать нам', en: 'Enterprise — message us', de: 'Enterprise – schreiben Sie uns', ar: 'Enterprise — راسلنا', kk: 'Enterprise — бізге жазыңыз', uz: 'Enterprise — bizga yozing' }, href: TELEGRAM_URL },
    ],
  },
  {
    title: { ru: 'Правовое', en: 'Legal', de: 'Rechtliches', ar: 'الشؤون القانونية', kk: 'Құқықтық', uz: 'Huquqiy hujjatlar' },
    links: [
      { label: { ru: 'Условия использования', en: 'Terms of Use', de: 'Nutzungsbedingungen', ar: 'شروط الاستخدام', kk: 'Пайдалану шарттары', uz: 'Foydalanish shartlari' }, to: '/terms' },
      { label: { ru: 'Политика конфиденциальности', en: 'Privacy Policy', de: 'Datenschutzerklärung', ar: 'سياسة الخصوصية', kk: 'Құпиялылық саясаты', uz: 'Maxfiylik siyosati' }, to: '/privacy' },
    ],
  },
];

function Head({ id }: { id: keyof typeof HEADS }) {
  const { lang } = useI18n();
  const head = HEADS[id];
  return (
    <Reveal className={styles.head}>
      <div className={styles.eyebrow}>{pickText(head.eyebrow, lang)}</div>
      <h2 className={styles.title}>{pickText(head.title, lang)}</h2>
      <p className={styles.sub}>{pickText(head.sub, lang)}</p>
    </Reveal>
  );
}

/** Появление секций при скролле — эталон components/Reveal.tsx (см. ниже). */
/* Скопировано дословно из эталона components/Reveal.tsx (whileInView, once,
   margin -80px, 0.7s EASE). */
function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ── Бесконечная вертикальная карусель сценариев (эталон UseCases) ────────── */

const UC_LABEL: Text2 = {
  ru: 'Ведущие юридические команды используют Lexab для',
  en: 'Leading legal teams use Lexab for',
  de: 'Führende Legal-Teams nutzen Lexab für',
};

const UC_ITEMS: Text2[] = [
  { ru: 'Юридических исследований', en: 'Legal research', de: 'Juristische Recherche' },
  { ru: 'Сопровождения сделок', en: 'Deal support', de: 'Dealbegleitung' },
  { ru: 'Due diligence', en: 'Due diligence', de: 'Due diligence' },
  { ru: 'Анализа контрактов', en: 'Contract analysis', de: 'Vertragsanalyse' },
  { ru: 'Проверки рисков', en: 'Risk review', de: 'Risikoprüfung' },
  { ru: 'Подготовки правок', en: 'Preparing redlines', de: 'Redlines vorbereiten' },
  { ru: 'Согласования договоров', en: 'Contract approvals', de: 'Vertragsfreigaben' },
  { ru: 'Массового разбора', en: 'Bulk review', de: 'Massenprüfung' },
  { ru: 'Электронного подписания', en: 'E-signing', de: 'E-Signatur' },
  { ru: 'Создания договоров', en: 'Contract drafting', de: 'Vertragserstellung' },
  { ru: 'Сравнения версий', en: 'Version comparison', de: 'Versionsvergleich' },
];

/* Константы эталона UseCases.tsx — дословно. */
const UC_CENTER = 3; // middle row of the 7-row window
const UC_OPACITY = [1, 0.35, 0.16, 0.07];
const UC_STEP_MS = 1500;
const UC_SLIDE_MS = 600;

function UseCasesCarousel() {
  const { lang } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  // Эталон: useInView(ref, { margin: "-15%" }).
  const inView = useInView(hostRef, { margin: '-15%' });
  const [idx, setIdx] = useState(UC_CENTER);
  const [instant, setInstant] = useState(false);
  /** Пауза при наведении — чтобы строку можно было дочитать. */
  const [hovered, setHovered] = useState(false);

  // duplicated head so the loop wraps without an empty tail (эталон).
  const list = [...UC_ITEMS, ...UC_ITEMS.slice(0, UC_CENTER + 1)];

  // Крутится только на экране и при включённой анимации (эталонный интервал).
  useEffect(() => {
    if (!inView || hovered || prefersReducedMotion()) return;
    const id = window.setInterval(() => setIdx((i) => i + 1), UC_STEP_MS);
    return () => window.clearInterval(id);
  }, [inView, hovered]);

  // Бесшовная петля: когда в центре дублированная голова — мгновенный снап.
  useEffect(() => {
    if (idx < UC_ITEMS.length) return;
    const t = window.setTimeout(() => {
      setInstant(true);
      setIdx((i) => i - UC_ITEMS.length);
    }, UC_SLIDE_MS + 40);
    return () => window.clearTimeout(t);
  }, [idx]);

  useEffect(() => {
    if (!instant) return;
    const t = window.setTimeout(() => setInstant(false), 50);
    return () => window.clearTimeout(t);
  }, [instant]);

  return (
    <section className={styles.section}>
      <div className={`${styles.inner} ${styles.ucGrid}`}>
        <Reveal>
          <p className={styles.ucLabel}>{pickText(UC_LABEL, lang)}</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div
            className={styles.ucWindow}
            ref={hostRef}
            aria-hidden="true"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div
              className={instant ? styles.ucTrack : `${styles.ucTrack} ${styles.ucTrackAnim}`}
              style={{ transform: `translateY(calc(${UC_CENTER - idx} * var(--uc-row)))` }}
            >
              {list.map((item, i) => {
                const dist = Math.min(Math.abs(i - idx), 3);
                return (
                  <div
                    key={`${item.en}-${i}`}
                    className={instant ? styles.ucRow : `${styles.ucRow} ${styles.ucRowAnim}`}
                    style={{ opacity: UC_OPACITY[dist] }}
                  >
                    {pickText(item, lang)}
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * Marketing sections below the first screen of the /login landing page:
 * features, how-it-works, demo, audiences, security, pricing, FAQ, footer.
 * `onStart` scrolls back to the sign-up card and opens the email form.
 */
export function LandingSections({ onStart }: { onStart: () => void }) {
  const { t, lang } = useI18n();
  const [yearly, setYearly] = useState(false);
  /** FAQ-аккордеон эталона: открыт максимум один вопрос (ключ — item.q.en). */
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  // Scroll-reveal for the remaining [data-reveal] elements (the demo window in
  // LandingDemo): tag them as hidden only when JS runs and motion is allowed,
  // then fade each one in as it enters the viewport. The section cards use the
  // эталонный useReveal-каскад (see <Reveal>).
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    els.forEach((el) => el.classList.add(styles.reveal));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealIn);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      els.forEach((el) => el.classList.remove(styles.reveal, styles.revealIn));
    };
  }, []);

  return (
    <>
      {/* ── Возможности — эталон Features.tsx (шапка слева, 4 карточки) ─── */}
      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <Reveal className={styles.plansHead}>
            <div className={styles.eyebrow}>{pickText(HEADS.features.eyebrow, lang)}</div>
            <h2 className={styles.plansSectionTitle}>{pickText({ ru: 'Всё, что юрист делает с договором, — быстрее', en: 'Everything a lawyer does with a contract — faster', de: 'Alles, was ein Jurist mit einem Vertrag macht – schneller' }, lang)}</h2>
          </Reveal>
          <div className={styles.cardsGrid}>
            {FEATURES.map((f, i) => (
              <Reveal key={f.icon} delay={i * 0.08}>
                <div className={styles.card}>
                  <span className={styles.cardIcon}>
                    <Icon name={f.icon} size={20} />
                  </span>
                  <h3 className={styles.cardTitle}>{pickText(f.title, lang)}</h3>
                  <p className={styles.cardText}>{pickText(f.text, lang)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Карта разделов: витрина, ведущая вглубь сайта ────────────────── */}
      <section id="sections" className={styles.section}>
        <div className={styles.inner}>
          <Reveal className={styles.plansHead}>
            <div className={styles.eyebrow}>
              {pickText({ ru: 'Разделы', en: 'Sections', de: 'Bereiche', ar: 'الأقسام', kk: 'Бөлімдер', uz: 'Boʻlimlar' }, lang)}
            </div>
            <h2 className={styles.plansSectionTitle}>
              {pickText(
                {
                  ru: 'Подробно о каждой части продукта',
                  en: 'Every part of the product, in detail',
                  de: 'Jeder Teil des Produkts im Detail',
                  ar: 'كل جزء من المنتج بالتفصيل',
                  kk: 'Өнімнің әр бөлігі туралы толық',
                  uz: 'Mahsulotning har bir qismi haqida batafsil',
                },
                lang,
              )}
            </h2>
          </Reveal>
          <div className={styles.mapGrid}>
            {SITE_MAP.map((col, i) => (
              <Reveal key={col.title.en} delay={i * 0.08}>
                <nav className={styles.card} aria-label={pickText(col.title, lang)}>
                  <div className={styles.mapGroupTitle}>{pickText(col.title, lang)}</div>
                  <div className={styles.mapLinks}>
                    {col.items.map((item) =>
                      item.kind === 'route' ? (
                        <Link key={item.slug} to={publicPath(item.slug)} className={styles.mapLink}>
                          {pickText(item.label, lang)}
                        </Link>
                      ) : null,
                    )}
                  </div>
                </nav>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Как это работает ─────────────────────────────────────────────── */}
      <section id="how-it-works" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.inner}>
          <Head id="how" />
          <div className={styles.steps}>
            {STEPS.map((s, i) => (
              <Reveal key={s.title.en} delay={i * 0.08}>
                {/* Карточка отдельно от Reveal: инлайновый transform появления
                    иначе глушил бы CSS-ховер (как у остальных секций). */}
                <div className={styles.step}>
                  <div className={styles.stepNum}>{String(i + 1).padStart(2, '0')}</div>
                  <div className={styles.stepTitle}>{pickText(s.title, lang)}</div>
                  <div className={styles.stepText}>{pickText(s.text, lang)}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Демо ─────────────────────────────────────────────────────────── */}
      <section id="demo" className={styles.section}>
        <div className={styles.inner}>
          <Head id="demo" />
          <LandingDemo />
          <div className={styles.demoNote}>{pickText(DEMO_NOTE, lang)}</div>
          <div className={styles.centerCta}>
            {/* Тёмная CTA — по правилу эталона с бегущим бликом. */}
            <button type="button" className={`btn-shimmer ${styles.ctaPrimary}`} onClick={onStart}>
              {t('landing.startFree')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Для кого — эталон Audience.tsx ───────────────────────────────── */}
      <section id="solutions" className={styles.section}>
        <div className={styles.inner}>
          <Reveal className={styles.plansHead}>
            <div className={styles.eyebrow}>{pickText(HEADS.solutions.eyebrow, lang)}</div>
            <h2 className={styles.plansSectionTitle}>{pickText({ ru: 'Создан для юридической работы любого масштаба', en: 'Built for legal work at any scale', de: 'Gemacht für juristische Arbeit jeder Größenordnung' }, lang)}</h2>
          </Reveal>
          <div className={styles.audienceGrid}>
            {AUDIENCES.map((a, i) => (
              <Reveal key={a.title.en} delay={i * 0.1}>
                <div className={styles.audienceCard}>
                  <h3 className={styles.audienceTitle}>{pickText(a.title, lang)}</h3>
                  <p className={styles.audienceText}>{pickText(a.text, lang)}</p>
                  <ul className={styles.audiencePoints}>
                    {a.points.map((p) => (
                      <li key={p.en}>
                        <Icon name="check" size={16} className={styles.planCheck} />
                        {pickText(p, lang)}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Безопасность — эталон Security.tsx (сплит 2fr/3fr + 4 карточки) ─ */}
      <section id="security" className={styles.section}>
        <div className={styles.inner}>
          <div className={styles.secSplit}>
            <Reveal>
              <div className={styles.eyebrow}>{pickText(HEADS.security.eyebrow, lang)}</div>
              <h2 className={styles.plansSectionTitle}>{pickText({ ru: 'Конфиденциальность — по умолчанию', en: 'Confidentiality — by default', de: 'Vertraulichkeit – standardmäßig' }, lang)}</h2>
              <p className={styles.secLead}>{pickText({ ru: 'Lexab создан для работы с чувствительными документами: адвокатская тайна и коммерческие условия клиентов остаются только вашими.', en: 'Lexab is built for sensitive documents: attorney–client privilege and your clients’ commercial terms stay yours alone.', de: 'Lexab ist für sensible Dokumente gemacht: Anwaltsgeheimnis und Konditionen Ihrer Mandanten bleiben allein bei Ihnen.' }, lang)}</p>
            </Reveal>
            <div className={styles.secCards}>
              {SECURITY.map((s, i) => (
                <Reveal key={s.title.en} delay={0.1 + i * 0.08}>
                  <div className={styles.secCard}>
                    <Icon name={s.icon} size={20} className={styles.secCardIcon} />
                    <h3 className={styles.secCardTitle}>{pickText(s.title, lang)}</h3>
                    <p className={styles.secCardText}>{pickText(s.text, lang)}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Карусель сценариев (эталон UseCases) — после «Безопасности» ──── */}
      <UseCasesCarousel />

      {/* ── Границы: что продукт НЕ делает. Стоит ВЫШЕ тарифов намеренно —
             честный список до цены делает цену убедительнее. ──────────────── */}
      <section id="limits" className={styles.section}>
        <div className={styles.inner}>
          <Reveal className={styles.plansHead}>
            <div className={styles.eyebrow}>
              {pickText({ ru: 'Границы', en: 'Boundaries', de: 'Grenzen', ar: 'الحدود', kk: 'Шекаралар', uz: 'Chegaralar' }, lang)}
            </div>
            <h2 className={styles.plansSectionTitle}>
              {pickText(
                {
                  ru: 'Чего Lexab не делает',
                  en: 'What Lexab does not do',
                  de: 'Was Lexab nicht tut',
                  ar: 'ما لا يفعله Lexab',
                  kk: 'Lexab не істемейді',
                  uz: 'Lexab nima qilmaydi',
                },
                lang,
              )}
            </h2>
          </Reveal>
          <div className={styles.limitsGrid}>
            {NOT_DOING.map((item, i) => (
              <Reveal key={item.title.en} delay={i * 0.06}>
                <div className={styles.limitItem}>
                  <h3 className={styles.limitTitle}>{pickText(item.title, lang)}</h3>
                  <p className={styles.limitText}>{pickText(item.text, lang)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Тарифы ───────────────────────────────────────────────────────── */}
      <section id="plans" className={styles.section}>
        <div className={styles.inner}>
          {/* Эталон Pricing.tsx: шапка секции слева (eyebrow + заголовок). */}
          <Reveal className={styles.plansHead}>
            <div className={styles.eyebrow}>{pickText(HEADS.plans.eyebrow, lang)}</div>
            <h2 className={styles.plansSectionTitle}>{pickText(HEADS.plans.title, lang)}</h2>
            <p className={styles.plansSectionSub}>{pickText(HEADS.plans.sub, lang)}</p>
          </Reveal>

          {/* Billing period — same 15% yearly discount as the in-app page.
              Тёмная «таблетка» скользит между кнопками (shared layoutId). */}
          <div className={styles.billingToggle} role="group" aria-label={t('landing.nav.plans')}>
            <button
              type="button"
              className={`${styles.billingBtn} ${!yearly ? styles.billingBtnActive : ''}`}
              aria-pressed={!yearly}
              onClick={() => setYearly(false)}
            >
              {!yearly ? (
                <motion.span
                  layoutId="billingPill"
                  className={styles.billingPill}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              ) : null}
              <span className={styles.billingLabel}>{t('plans.monthly')}</span>
            </button>
            <button
              type="button"
              className={`${styles.billingBtn} ${yearly ? styles.billingBtnActive : ''}`}
              aria-pressed={yearly}
              onClick={() => setYearly(true)}
            >
              {yearly ? (
                <motion.span
                  layoutId="billingPill"
                  className={styles.billingPill}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              ) : null}
              <span className={styles.billingLabel}>
                {t('plans.yearly')}
                <span className={styles.billingBadge}>−15%</span>
              </span>
            </button>
          </div>

          <div className={styles.plansGrid}>
            {PLANS.map((p, i) => (
              <Reveal
                key={p.name}
                delay={i * 0.08}
                className={`${styles.plan} ${p.popular ? styles.planPopular : ''}`}
              >
                {/* Эталон Pricing.tsx: имя-эйбрау и бейдж «Популярный» в одной строке. */}
                <div className={styles.planNameRow}>
                  <div className={styles.planName}>
                    <span className={styles.planDot} style={{ background: p.dot }} />
                    {p.name}
                  </div>
                  {p.popular ? (
                    <span className={styles.planBadge}>{pickText({ ru: 'Популярный', en: 'Popular', de: 'Beliebt', ar: 'الأكثر شيوعًا', kk: 'Танымал', uz: 'Ommabop' }, lang)}</span>
                  ) : null}
                </div>
                <div className={styles.planPrice}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {yearly && p.monthly > 0 ? (
                      <motion.span
                        key="old-price"
                        className={styles.planPriceOld}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      >
                        ${p.monthly}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                  {/* Перекат цены при смене месячный↔годовой. */}
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={yearly ? 'yearly' : 'monthly'}
                      style={{ display: 'inline-block' }}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      ${yearly ? monthlyEqYearly(p) : p.monthly}
                    </motion.span>
                  </AnimatePresence>
                  <span className={styles.planPer}>{pickText({ ru: '/мес', en: '/mo', de: '/Mon.', ar: '/شهر', kk: '/ай', uz: '/oy' }, lang)}</span>
                </div>
                {yearly && p.monthly > 0 ? (
                  <div className={styles.planPriceNote}>{t('plans.yearlyNote')}</div>
                ) : null}
                <div className={styles.planTagline}>{pickText(p.tagline, lang)}</div>
                {p.inherits ? <div className={styles.planInherits}>{pickText(p.inherits, lang)}</div> : null}
                <ul className={styles.planFeatures}>
                  {p.features.map((f) => (
                    <li key={f.en}>
                      <Icon name="check" size={13} className={styles.planCheck} />
                      {pickText(f, lang)}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={p.popular ? `btn-shimmer ${styles.planBtnDark}` : styles.planBtnFilled}
                  onClick={onStart}
                >
                  {p.name === 'Free' ? t('landing.startFree') : t('landing.choosePlan')}
                </button>
              </Reveal>
            ))}
          </div>
          {/* Enterprise — custom pricing, full-width card (mirrors the in-app page). */}
          <Reveal className={styles.enterprise}>
            <div className={styles.enterpriseInfo}>
              <div className={styles.planName}>
                <span className={styles.planDot} style={{ background: ENTERPRISE.dot }} />
                Enterprise
              </div>
              <div className={styles.planTagline}>{pickText(ENTERPRISE.tagline, lang)}</div>
              <div className={styles.enterprisePrice}>{pickText(ENTERPRISE.priceLabel, lang)}</div>
              <a
                className={styles.enterpriseCta}
                href={TELEGRAM_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                {pickText({ ru: 'Связаться', en: 'Contact us', de: 'Kontakt aufnehmen', ar: 'تواصل معنا', kk: 'Байланысу', uz: "Bog'lanish" }, lang)}
              </a>
            </div>
            <ul className={styles.enterpriseFeatures}>
              {ENTERPRISE.features.map((f) => (
                <li key={f.en}>
                  <Icon name="check" size={13} className={styles.planCheck} />
                  {pickText(f, lang)}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className={styles.section}>
        <div className={styles.inner}>
          <Head id="faq" />
          <div className={styles.faq}>
            {FAQ_GROUPS.map((group, gi) => (
              <Reveal key={group.title.en} delay={gi * 0.08}>
                <h3 className={styles.faqGroupTitle}>{pickText(group.title, lang)}</h3>
                {/* Аккордеон эталона: высота через глобальные faq-item/faq-body
                    (grid-rows), стрелка поворачивается на 180°. */}
                {group.items.map((item) => {
                  const open = openFaq === item.q.en;
                  return (
                    <div
                      key={item.q.en}
                      data-open={open}
                      className={`faq-item ${styles.faqItem}`}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        className={styles.faqQ}
                        onClick={() => setOpenFaq(open ? null : item.q.en)}
                      >
                        {pickText(item.q, lang)}
                        <span className={styles.faqToggle}>
                          <Icon name="chevron" size={16} />
                        </span>
                      </button>
                      <div className="faq-body">
                        <div>
                          <div className={styles.faqA}>
                            {pickText(item.a, lang)}
                            {item.link ? (
                              <button
                                type="button"
                                className={styles.faqLink}
                                onClick={() =>
                                  document
                                    .getElementById(item.link!.id)
                                    ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                                }
                              >
                                {pickText(item.link.label, lang)} →
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pre-footer CTA banner ────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <Reveal className={`${styles.ctaBanner} glass-card sheen`}>
            <span className={styles.ctaBannerGrid} aria-hidden="true" />
            <h2 className={styles.ctaBannerTitle}>
              {pickText({ ru: 'Готовы ускорить работу с контрактами?', en: 'Ready to speed up your contract work?', de: 'Bereit, Ihre Vertragsarbeit zu beschleunigen?', ar: 'هل أنت مستعد لتسريع العمل على عقودك؟', kk: 'Келісімшарт жұмысын жеделдетуге дайынсыз ба?', uz: 'Shartnomalar bilan ishlashni tezlashtirishga tayyormisiz?' }, lang)}
            </h2>
            <p className={styles.ctaBannerSub}>
              {pickText({ ru: 'Пилот за 3 дня. Никакой карты. Полный доступ к возможностям Enterprise.', en: 'A 3-day pilot. No card. Full access to Enterprise features.', de: 'Pilot in 3 Tagen. Keine Karte nötig. Voller Zugriff auf Enterprise-Funktionen.', ar: 'تجربة خلال 3 أيام. دون بطاقة. وصول كامل إلى إمكانات Enterprise.', kk: '3 күнде пилот. Карта қажет емес. Enterprise мүмкіндіктеріне толық қолжетімділік.', uz: "3 kunda pilot. Karta shart emas. Enterprise imkoniyatlaridan to'liq foydalanish." }, lang)}
            </p>
            <div className={styles.ctaBannerBtns}>
              {/* Единственная тёмная кнопка секции + shimmer-полоса эталона. */}
              <button type="button" className={`btn-shimmer ${styles.ctaBannerPrimary}`} onClick={onStart}>
                {t('landing.navCta')}
                <Icon name="arrowRight" size={17} />
              </button>
              <button
                type="button"
                className={styles.ctaBannerGhost}
                onClick={() =>
                  document.getElementById('demo')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                }
              >
                {t('landing.viewDemo')}
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrandCol}>
            <div className={styles.footerLogo}>
              <Avatar size={30} />
              <span>Lexab</span>
            </div>
            <p className={styles.footerTagline}>{t('auth.tagline')}</p>
            <p className={styles.footerJuris}>
              {pickText({ ru: 'Юрисдикции: Великобритания · США · Германия · Канада · Казахстан · Узбекистан · ОАЭ', en: 'Jurisdictions: United Kingdom · United States · Germany · Canada · Kazakhstan · Uzbekistan · UAE', de: 'Jurisdiktionen: Großbritannien · USA · Deutschland · Kanada · Kasachstan · Usbekistan · VAE', ar: 'الولايات القضائية: المملكة المتحدة · الولايات المتحدة · ألمانيا · كندا · كازاخستان · أوزبكستان · الإمارات', kk: 'Юрисдикциялар: Ұлыбритания · АҚШ · Германия · Канада · Қазақстан · Өзбекстан · БАӘ', uz: "Yurisdiksiyalar: Buyuk Britaniya · AQSH · Germaniya · Kanada · Qozog'iston · O'zbekiston · BAA" }, lang)}
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <nav key={col.title.en} className={styles.footerCol} aria-label={pickText(col.title, lang)}>
              <div className={styles.footerColTitle}>{pickText(col.title, lang)}</div>
              {col.links.map((l) =>
                l.anchor ? (
                  <button
                    key={l.label.en}
                    type="button"
                    className={styles.footerLink}
                    onClick={() =>
                      document
                        .getElementById(l.anchor!)
                        ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                    }
                  >
                    {pickText(l.label, lang)}
                  </button>
                ) : l.to ? (
                  <Link key={l.label.en} to={l.to} className={styles.footerLink}>
                    {pickText(l.label, lang)}
                  </Link>
                ) : (
                  <a
                    key={l.label.en}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.footerLink}
                  >
                    {pickText(l.label, lang)}
                  </a>
                ),
              )}
            </nav>
          ))}
        </div>

        <div className={styles.footerBottom}>© {new Date().getFullYear()} Lexab · {t('auth.tagline')}</div>
      </footer>
    </>
  );
}
