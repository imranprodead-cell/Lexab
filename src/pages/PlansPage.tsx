import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { CountrySelector } from '@/components/layout/CountrySelector';
import { Icon } from '@/components/icons/Icon';
import { billingApi, type BillingPeriod } from '@/api/billing.api';
import { Spinner } from '@/components/ui/Spinner';
import { useAsync, clearAsyncCache } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { pickText, type Language } from '@/i18n/messages';
import styles from './pages.module.css';

/** Yearly billing discount (also applied by POST /billing/checkout → Stripe). */
const YEARLY_DISCOUNT = 0.15;

/** Текст карточки тарифа. Раньше был только {ru, en} — немец, казах, узбек и
 *  араб читали прайс по-английски посреди своего интерфейса (аудит 2026-08-03).
 *  pickText сам выбирает нужный язык, а при отсутствии перевода падает на en. */
type Text2 = { ru: string; en: string } & Partial<Record<Language, string>>;

interface Plan {
  name: string;
  dot: string;
  price: Text2;
  /** Numeric monthly price in USD; undefined = custom pricing (Enterprise). */
  monthly?: number;
  /** Фактическая ГОДОВАЯ цена у платёжного провайдера, если она не равна
   *  monthly*12*(1−15%): у Lemon Squeezy потолок цены $5000 — годовой
   *  Business стоит ровно $5000 вместо расчётных $5088. */
  yearlyTotal?: number;
  accent?: boolean;
  popular?: boolean;
  cta: Text2;
  tagline: Text2;
  inherits?: Text2;
  features: Text2[];
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    dot: '#5F5F6A',
    price: { ru: "$0", en: "$0", de: "$0", kk: "$0", uz: "$0", ar: "$0" },
    monthly: 0,
    cta: { ru: "Начало работы", en: "Get started", de: "Loslegen", kk: "Бастау", uz: "Boshlash", ar: "ابدأ الآن" },
    tagline: {
      ru: "Узнайте, что Lexab может сделать для вас",
      en: "See what Lexab can do for you",
      de: "Sehen Sie, was Lexab für Sie tun kann",
      kk: "Lexab сіз үшін не істей алатынын көріңіз",
      uz: "Lexab siz uchun nima qila olishini koʻring",
      ar: "اكتشف ما يمكن أن يقدمه لك Lexab",
    },
    features: [
      {
        ru: "20 AI-запросов в месяц",
        en: "20 AI requests per month",
        de: "20 KI-Anfragen pro Monat",
        kk: "Айына 20 ЖИ сұрауы",
        uz: "Oyiga 20 ta AI soʻrovi",
        ar: "20 طلب ذكاء اصطناعي شهريًا",
      },
      { ru: "До 3 документов", en: "Up to 3 documents", de: "Bis zu 3 Dokumente", kk: "3 құжатқа дейін", uz: "3 tagacha hujjat", ar: "حتى 3 مستندات" },
      {
        ru: "AI-чат с документами",
        en: "AI chat with documents",
        de: "KI-Chat mit Dokumenten",
        kk: "Құжаттармен ЖИ-чат",
        uz: "Hujjatlar bilan AI-chat",
        ar: "محادثة ذكية مع المستندات",
      },
      { ru: "Краткое AI-резюме", en: "AI summary", de: "KI-Zusammenfassung", kk: "ЖИ түйіндемесі", uz: "AI xulosasi", ar: "ملخّص بالذكاء الاصطناعي" },
      { ru: "Экспорт в PDF", en: "PDF export", de: "PDF-Export", kk: "PDF-ке экспорттау", uz: "PDF ga eksport", ar: "التصدير إلى PDF" },
    ],
  },
  {
    name: 'Standard',
    dot: '#3FB8AF',
    price: { ru: "$15", en: "$15", de: "$15", kk: "$15", uz: "$15", ar: "$15" },
    monthly: 15,
    cta: {
      ru: "Перейти в Standard",
      en: "Upgrade to Standard",
      de: "Auf Standard wechseln",
      kk: "Standard-ке ауысу",
      uz: "Standard ga oʻtish",
      ar: "الترقية إلى Standard",
    },
    tagline: {
      ru: "Для студентов, фрилансеров и стартапов",
      en: "For students, freelancers and startups",
      de: "Für Studierende, Freelancer und Start-ups",
      kk: "Студенттерге, фрилансерлерге және стартаптарға",
      uz: "Talabalar, frilanserlar va startaplar uchun",
      ar: "للطلاب والمستقلين والشركات الناشئة",
    },
    features: [
      {
        ru: "До 100 AI-запросов в месяц",
        en: "Up to 100 AI requests per month",
        de: "Bis zu 100 KI-Anfragen pro Monat",
        kk: "Айына 100-ге дейін ЖИ сұрауы",
        uz: "Oyiga 100 tagacha AI soʻrovi",
        ar: "حتى 100 طلب ذكاء اصطناعي شهريًا",
      },
      {
        ru: "До 20 документов в месяц",
        en: "Up to 20 documents per month",
        de: "Bis zu 20 Dokumente pro Monat",
        kk: "Айына 20 құжатқа дейін",
        uz: "Oyiga 20 tagacha hujjat",
        ar: "حتى 20 مستندًا شهريًا",
      },
      {
        ru: "AI-чат с документами",
        en: "AI chat with documents",
        de: "KI-Chat mit Dokumenten",
        kk: "Құжаттармен ЖИ-чат",
        uz: "Hujjatlar bilan AI-chat",
        ar: "محادثة ذكية مع المستندات",
      },
      {
        ru: "Генератор договоров",
        en: "Contract generator",
        de: "Vertragsgenerator",
        kk: "Шарт генераторы",
        uz: "Shartnoma generatori",
        ar: "مولّد العقود",
      },
      { ru: "Анализ рисков", en: "Risk analysis", de: "Risikoanalyse", kk: "Тәуекелдерді талдау", uz: "Xavflarni tahlil qilish", ar: "تحليل المخاطر" },
      { ru: "Краткое AI-резюме", en: "AI summary", de: "KI-Zusammenfassung", kk: "ЖИ түйіндемесі", uz: "AI xulosasi", ar: "ملخّص بالذكاء الاصطناعي" },
      {
        ru: "Экспорт в PDF и DOCX",
        en: "PDF & DOCX export",
        de: "PDF- und DOCX-Export",
        kk: "PDF және DOCX экспорты",
        uz: "PDF va DOCX eksporti",
        ar: "التصدير إلى PDF و DOCX",
      },
      {
        ru: "2 ГБ защищённого хранилища",
        en: "2 GB secure storage",
        de: "2 GB sicherer Speicher",
        kk: "2 ГБ қорғалған қойма",
        uz: "2 GB himoyalangan xotira",
        ar: "2 غيغابايت تخزين آمن",
      },
      {
        ru: "Поддержка по почте",
        en: "Email support",
        de: "E-Mail-Support",
        kk: "Поштамен қолдау",
        uz: "Pochta orqali qoʻllab-quvvatlash",
        ar: "دعم عبر البريد",
      },
    ],
  },
  {
    name: 'Pro',
    dot: '#5B8DEF',
    price: { ru: "$50", en: "$50", de: "$50", kk: "$50", uz: "$50", ar: "$50" },
    monthly: 50,
    accent: true,
    popular: true,
    cta: { ru: "Перейти в Pro", en: "Upgrade to Pro", de: "Auf Pro wechseln", kk: "Pro-ға ауысу", uz: "Pro ga oʻtish", ar: "الترقية إلى Pro" },
    tagline: {
      ru: "Для юристов и малого бизнеса",
      en: "For lawyers and small businesses",
      de: "Für Anwälte und kleine Unternehmen",
      kk: "Заңгерлер мен шағын бизнеске",
      uz: "Yuristlar va kichik biznes uchun",
      ar: "للمحامين والشركات الصغيرة",
    },
    inherits: {
      ru: "Всё из Standard, плюс:",
      en: "Everything in Standard, plus:",
      de: "Alles aus Standard, plus:",
      kk: "Standard-тегінің бәрі, қосымша:",
      uz: "Standard dagi hammasi, ustiga:",
      ar: "كل ما في Standard، بالإضافة إلى:",
    },
    features: [
      {
        ru: "До 500 AI-запросов в месяц",
        en: "Up to 500 AI requests per month",
        de: "Bis zu 500 KI-Anfragen pro Monat",
        kk: "Айына 500-ге дейін ЖИ сұрауы",
        uz: "Oyiga 500 tagacha AI soʻrovi",
        ar: "حتى 500 طلب ذكاء اصطناعي شهريًا",
      },
      {
        ru: "До 80 документов в месяц",
        en: "Up to 80 documents per month",
        de: "Bis zu 80 Dokumente pro Monat",
        kk: "Айына 80 құжатқа дейін",
        uz: "Oyiga 80 tagacha hujjat",
        ar: "حتى 80 مستندًا شهريًا",
      },
      {
        ru: "Сравнение версий (Redline)",
        en: "Version compare (Redline)",
        de: "Versionsvergleich (Redline)",
        kk: "Нұсқаларды салыстыру (Redline)",
        uz: "Versiyalarni solishtirish (Redline)",
        ar: "مقارنة الإصدارات (Redline)",
      },
      {
        ru: "Разбор договора с правками",
        en: "Contract review with redlines",
        de: "Vertragsprüfung mit Änderungen",
        kk: "Түзетулермен шартты талдау",
        uz: "Tuzatishlar bilan shartnoma tahlili",
        ar: "مراجعة العقد مع التعديلات",
      },
      {
        ru: "Предложения формулировок",
        en: "Clause suggestions",
        de: "Klausel-Vorschläge",
        kk: "Тармақ нұсқаларын ұсыну",
        uz: "Band takliflari",
        ar: "اقتراحات الصياغة",
      },
      { ru: "История версий", en: "Version history", de: "Versionsverlauf", kk: "Нұсқалар тарихы", uz: "Versiyalar tarixi", ar: "سجل الإصدارات" },
      {
        ru: "Маршруты согласования",
        en: "Approval workflows",
        de: "Freigabe-Workflows",
        kk: "Келісу маршруттары",
        uz: "Kelishuv marshrutlari",
        ar: "مسارات الموافقة",
      },
      {
        ru: "50 ГБ защищённого хранилища",
        en: "50 GB secure storage",
        de: "50 GB sicherer Speicher",
        kk: "50 ГБ қорғалған қойма",
        uz: "50 GB himoyalangan xotira",
        ar: "50 غيغابايت تخزين آمن",
      },
      {
        ru: "Приоритетная поддержка",
        en: "Priority support",
        de: "Priorisierter Support",
        kk: "Басым қолдау",
        uz: "Ustuvor qoʻllab-quvvatlash",
        ar: "دعم ذو أولوية",
      },
      {
        ru: "Ранний доступ к новым функциям",
        en: "Early access to new features",
        de: "Früher Zugang zu neuen Funktionen",
        kk: "Жаңа мүмкіндіктерге ерте қолжетімділік",
        uz: "Yangi imkoniyatlarga erta kirish",
        ar: "وصول مبكر للميزات الجديدة",
      },
    ],
  },
  {
    name: 'Business',
    dot: '#8B7CF6',
    price: { ru: "$499", en: "$499", de: "$499", kk: "$499", uz: "$499", ar: "$499" },
    monthly: 499,
    yearlyTotal: 5000,
    cta: {
      ru: "Перейти в Business",
      en: "Upgrade to Business",
      de: "Auf Business wechseln",
      kk: "Business-ке ауысу",
      uz: "Business ga oʻtish",
      ar: "الترقية إلى Business",
    },
    tagline: {
      ru: "Для юридических фирм и компаний",
      en: "For law firms and companies",
      de: "Für Kanzleien und Unternehmen",
      kk: "Заң фирмалары мен компанияларға",
      uz: "Yuridik firmalar va kompaniyalar uchun",
      ar: "لمكاتب المحاماة والشركات",
    },
    inherits: {
      ru: "Всё из Pro, плюс:",
      en: "Everything in Pro, plus:",
      de: "Alles aus Pro, plus:",
      kk: "Pro-дағының бәрі, қосымша:",
      uz: "Pro dagi hammasi, ustiga:",
      ar: "كل ما في Pro، بالإضافة إلى:",
    },
    features: [
      {
        ru: "Доступ к самым мощным AI-моделям",
        en: "Access to the most capable AI models",
        de: "Zugang zu den leistungsstärksten KI-Modellen",
        kk: "Ең қуатты ЖИ модельдеріне қолжетімділік",
        uz: "Eng kuchli AI modellariga kirish",
        ar: "الوصول إلى أقوى نماذج الذكاء الاصطناعي",
      },
      {
        ru: "До 5 пользователей",
        en: "Up to 5 users",
        de: "Bis zu 5 Nutzer",
        kk: "5 пайдаланушыға дейін",
        uz: "5 tagacha foydalanuvchi",
        ar: "حتى 5 مستخدمين",
      },
      {
        ru: "До 10 000 AI-запросов в месяц",
        en: "Up to 10,000 AI requests per month",
        de: "Bis zu 10.000 KI-Anfragen pro Monat",
        kk: "Айына 10 000-ға дейін ЖИ сұрауы",
        uz: "Oyiga 10 000 tagacha AI soʻrovi",
        ar: "حتى 10٬000 طلب ذكاء اصطناعي شهريًا",
      },
      {
        ru: "До 700 документов в месяц",
        en: "Up to 700 documents per month",
        de: "Bis zu 700 Dokumente pro Monat",
        kk: "Айына 700 құжатқа дейін",
        uz: "Oyiga 700 tagacha hujjat",
        ar: "حتى 700 مستند شهريًا",
      },
      {
        ru: "Общие рабочие пространства",
        en: "Shared workspaces",
        de: "Gemeinsame Arbeitsbereiche",
        kk: "Ортақ жұмыс кеңістіктері",
        uz: "Umumiy ish maydonlari",
        ar: "مساحات عمل مشتركة",
      },
      {
        ru: "Управление ролями и правами доступа",
        en: "Roles & access management",
        de: "Rollen- und Zugriffsverwaltung",
        kk: "Рөлдер мен қолжетімділікті басқару",
        uz: "Rollar va kirish huquqlarini boshqarish",
        ar: "إدارة الأدوار والصلاحيات",
      },
      {
        ru: "Совместная работа над документами",
        en: "Document collaboration",
        de: "Gemeinsames Arbeiten an Dokumenten",
        kk: "Құжаттармен бірлескен жұмыс",
        uz: "Hujjatlar ustida hamkorlikda ishlash",
        ar: "العمل التشاركي على المستندات",
      },
      { ru: "Журнал действий", en: "Audit log", de: "Audit-Log", kk: "Әрекеттер журналы", uz: "Amallar jurnali", ar: "سجل الإجراءات" },
      {
        ru: "API-доступ (1000 анализов/мес)",
        en: "API access (1,000 analyses/mo)",
        de: "API-Zugang (1.000 Analysen/Monat)",
        kk: "API қолжетімділігі (айына 1000 талдау)",
        uz: "API kirish (oyiga 1000 tahlil)",
        ar: "وصول API (1000 تحليل شهريًا)",
      },
      {
        ru: "Расширенная аналитика",
        en: "Advanced analytics",
        de: "Erweiterte Analysen",
        kk: "Кеңейтілген аналитика",
        uz: "Kengaytirilgan analitika",
        ar: "تحليلات متقدمة",
      },
      {
        ru: "Единый вход (SSO)",
        en: "Single Sign-On (SSO)",
        de: "Single Sign-On (SSO)",
        kk: "Бірыңғай кіру (SSO)",
        uz: "Yagona kirish (SSO)",
        ar: "الدخول الموحّد (SSO)",
      },
      {
        ru: "1 ТБ защищённого хранилища",
        en: "1 TB secure storage",
        de: "1 TB sicherer Speicher",
        kk: "1 ТБ қорғалған қойма",
        uz: "1 TB himoyalangan xotira",
        ar: "1 تيرابايت تخزين آمن",
      },
      {
        ru: "Выделенный менеджер",
        en: "Dedicated customer success manager",
        de: "Persönlicher Kundenbetreuer",
        kk: "Жеке менеджер",
        uz: "Shaxsiy menejer",
        ar: "مدير حساب مخصّص",
      },
    ],
  },
  {
    name: 'Enterprise',
    dot: '#9A9AA6',
    price: { ru: "По договорённости", en: "Custom pricing", de: "Individuelle Preise", kk: "Келісім бойынша", uz: "Kelishuv asosida", ar: "تسعير مخصّص" },
    cta: { ru: "Связаться", en: "Contact us", de: "Kontakt aufnehmen", kk: "Хабарласу", uz: "Bogʻlanish", ar: "تواصل معنا" },
    tagline: {
      ru: "Индивидуальные условия и внедрение — по созвону.",
      en: "Custom terms and onboarding — book a call.",
      de: "Individuelle Konditionen und Einführung — im Gespräch.",
      kk: "Жеке шарттар мен енгізу — қоңырау арқылы.",
      uz: "Individual shartlar va joriy etish — qoʻngʻiroq orqali.",
      ar: "شروط وتنفيذ مخصّصان — عبر مكالمة.",
    },
    features: [
      {
        ru: "Без ограничения по пользователям и документам",
        en: "Unlimited users and documents",
        de: "Unbegrenzte Nutzer und Dokumente",
        kk: "Пайдаланушылар мен құжаттар шектеусіз",
        uz: "Foydalanuvchi va hujjatlar cheklovsiz",
        ar: "مستخدمون ومستندات بلا حدود",
      },
      {
        ru: "Приватные модели или размещение у вас",
        en: "Private or self-hosted AI models",
        de: "Private oder selbst gehostete KI-Modelle",
        kk: "Жеке немесе өз серверіңіздегі модельдер",
        uz: "Shaxsiy yoki oʻz serveringizdagi modellar",
        ar: "نماذج خاصة أو مستضافة لديك",
      },
      {
        ru: "Индивидуальные интеграции и API",
        en: "Custom integrations and API",
        de: "Individuelle Integrationen und API",
        kk: "Жеке интеграциялар мен API",
        uz: "Individual integratsiyalar va API",
        ar: "تكاملات و API مخصّصة",
      },
      {
        ru: "Персональный SLA и поддержка 24/7",
        en: "Personal SLA and 24/7 support",
        de: "Persönliches SLA und 24/7-Support",
        kk: "Жеке SLA және 24/7 қолдау",
        uz: "Shaxsiy SLA va 24/7 qoʻllab-quvvatlash",
        ar: "اتفاقية خدمة شخصية ودعم 24/7",
      },
      {
        ru: "Юридический онбординг команды",
        en: "Legal onboarding for your team",
        de: "Juristisches Onboarding für Ihr Team",
        kk: "Команданы заңды енгізу",
        uz: "Jamoani yuridik joriy etish",
        ar: "تهيئة قانونية لفريقك",
      },
    ],
  },
];

function PlanCard({
  plan,
  period,
  wide,
  current,
  currentPeriod,
  lsManaged,
  onPurchased,
  delay = 0,
}: {
  plan: Plan;
  period: BillingPeriod;
  wide?: boolean;
  current?: boolean;
  /** Период действующей подписки ('monthly'|'yearly') — для честной CTA. */
  currentPeriod?: BillingPeriod | null;
  /** Подписка живёт у Lemon Squeezy: «продлить» текущий план бессмысленно
   *  (продлевает провайдер), а смена периода — платная прората. */
  lsManaged?: boolean;
  onPurchased?: (plan: string) => void;
  /** Задержка каскада появления (декоративная). */
  delay?: number;
}) {
  const { t, lang } = useI18n();
  const reveal = useReveal<HTMLDivElement>(delay);
  const pushToast = useUIStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  // Consent step before a paid purchase: the withdrawal-right waiver must be
  // explicitly ticked (unchecked by default) to make the no-refund term lawful.
  const [confirming, setConfirming] = useState(false);
  const [consent, setConsent] = useState(false);

  const yearly = period === 'yearly';
  const hasNumericPrice = plan.monthly !== undefined;
  // Месячный эквивалент годовой цены: из фактической цены провайдера, если
  // она задана (Business: $5000/год из-за потолка LS → $417/мес), иначе −15%.
  const yearlyMonthlyEq = hasNumericPrice
    ? plan.yearlyTotal !== undefined
      ? Math.round(plan.yearlyTotal / 12)
      : Math.round((plan.monthly as number) * (1 - YEARLY_DISCOUNT))
    : 0;
  const shownPrice = hasNumericPrice ? `$${yearly ? yearlyMonthlyEq : plan.monthly}` : pickText(plan.price, lang);
  const showDiscount = yearly && hasNumericPrice && (plan.monthly as number) > 0;
  const longPrice = shownPrice.length > 6;

  const buy = () => {
    if (busy) return;
    if (plan.name === 'Enterprise') {
      setBusy(true);
      billingApi
        .contactSales()
        .then(() => pushToast(t('plans.contactSent'), 'success'))
        .catch(() => pushToast(t('plans.checkoutFailed'), 'error'))
        .finally(() => setBusy(false));
      return;
    }
    if (plan.name === 'Free') {
      pushToast(t('plans.freeActive'), 'success');
      return;
    }
    // Paid plan: open the consent step instead of buying immediately. Clear any
    // leftover tick so the waiver must be re-checked explicitly every time.
    setConsent(false);
    setConfirming(true);
  };

  const confirmPurchase = () => {
    if (busy) return;
    if (!consent) {
      pushToast(t('plans.consentRequired'), 'error');
      return;
    }
    setBusy(true);
    let redirecting = false;
    billingApi
      .checkout(plan.name, period, true)
      .then((res) => {
        // Новая покупка через Lemon Squeezy: уходим на их страницу оплаты;
        // активация придёт вебхуком, а возврат — на /plans?checkout=success.
        if (res.url) {
          // busy НЕ сбрасываем: навигация на внешний URL занимает секунды, и
          // повторный клик успел бы создать второй checkout + дублировать
          // consent-запись в append-only журнале.
          redirecting = true;
          window.location.assign(res.url);
          return;
        }
        clearAsyncCache(); // sidebar/settings quotas re-read the new plan
        onPurchased?.(res.plan);
        setConfirming(false);
        setConsent(false);
        pushToast(
          res.changed
            ? t('plans.changed', { plan: res.plan })
            : yearly
              ? t('plans.activatedYearly', { plan: res.plan, d: res.discountPercent })
              : t('plans.activatedMonthly', { plan: res.plan }),
          'success',
        );
      })
      .catch((err) => pushToast(err instanceof Error && err.message ? err.message : t('plans.checkoutFailed'), 'error'))
      .finally(() => {
        if (!redirecting) setBusy(false);
      });
  };

  return (
    <div ref={reveal} className={`${styles.planCard} ${plan.accent ? styles.planCardAccent : ''} ${wide ? styles.planWide : ''}`}>
      {plan.popular && !current ? <span className={styles.planBadge}>{t('plans.popular')}</span> : null}
      {current ? <span className={styles.planBadge}>{t('plans.best')}</span> : null}
      <div>
        <div className={styles.planName}>
          <span className={styles.planDot} style={{ background: plan.dot }} />
          {plan.name}
        </div>
        <div className={styles.planTagline}>{pickText(plan.tagline, lang)}</div>
      </div>
      <div className={styles.planPrice}>
        {showDiscount ? <span className={styles.planPriceOld}>${plan.monthly}</span> : null}
        <span className={`${styles.planPriceValue} ${longPrice ? styles.planPriceValueSm : ''}`}>{shownPrice}</span>
        {hasNumericPrice ? <span className={styles.planPer}>{t('plans.perMonth')}</span> : null}
      </div>
      {showDiscount ? <div className={styles.planPriceNote}>{t('plans.yearlyNote')}</div> : null}
      {plan.inherits ? <div className={styles.planInherits}>{pickText(plan.inherits, lang)}</div> : null}
      <div className={styles.planFeatures}>
        {plan.features.map((f) => (
          <div key={f.en} className={styles.planFeature}>
            <span className={styles.planCheck}>
              <Icon name="check" size={10} strokeWidth={2.6} />
            </span>
            {pickText(f, lang)}
          </div>
        ))}
      </div>
      {confirming ? (
        <div className={styles.planConsent}>
          <label className={styles.planConsentRow}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('plans.consentLabel')}</span>
          </label>
          <div className={styles.planConsentActions}>
            <button
              className={`${styles.planCta} ${plan.accent ? `${styles.planCtaAccent} btn-shimmer` : ''}`}
              disabled={busy || !consent}
              onClick={confirmPurchase}
            >
              {busy ? t('plans.opening') : t('plans.confirmPurchase')}
            </button>
            <button
              className={styles.planConsentCancel}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setConsent(false);
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : lsManaged && current && (currentPeriod ?? 'monthly') === period ? (
        // Текущий LS-план в текущем периоде: «обновить лимиты» дал бы 400
        // (продлевает провайдер), — честная неактивная кнопка. Другой период
        // остаётся кликабельным: это реальная платная смена периода с проратой.
        <button className={styles.planCta} disabled>
          {t('plans.currentBtn')}
        </button>
      ) : (
        <button
          className={`${styles.planCta} ${plan.accent && !current ? `${styles.planCtaAccent} btn-shimmer` : ''}`}
          disabled={busy}
          onClick={buy}
        >
          {busy ? t('plans.opening') : current ? (lsManaged ? t('plans.switchPeriod') : t('plans.renew')) : pickText(plan.cta, lang)}
        </button>
      )}
    </div>
  );
}

/** Full-page pricing view (Free / Standard / Pro / Business in a row, Enterprise below). */
export function PlansPage() {
  const { t } = useI18n();
  usePageTitle(t('plans.topTitle'));
  const firstFour = PLANS.slice(0, 4);
  const enterprise = PLANS[4];
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

  // Real current plan (not hardcoded) + instant update after purchase.
  const limits = useAsync((signal) => billingApi.limits(signal), []);
  const subscription = useAsync((signal) => billingApi.subscription(signal), []);
  const [justBought, setJustBought] = useState<string | null>(null);
  const currentPlan = justBought ?? limits.data?.plan ?? null;
  const pushToast = useUIStore((s) => s.pushToast);

  // Возврат со страницы оплаты Lemon Squeezy (?checkout=success): вебхук может
  // отстать от редиректа на секунды — показываем «обрабатываем» и поллим
  // подписку до смены плана (потолок ~60с), затем обновляем весь кабинет.
  const [processingPayment, setProcessingPayment] = useState(
    () => new URLSearchParams(window.location.search).get('checkout') === 'success',
  );
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!processingPayment) return;
    // Параметр убираем сразу — перезагрузка страницы не перезапустит ожидание.
    window.history.replaceState(null, '', window.location.pathname);
    const startedAt = Date.now();
    // alive-флаг: in-flight запрос, завершившийся ПОСЛЕ ухода со страницы, не
    // должен перезапустить цикл (утечка таймера + setState на размонтированном).
    let alive = true;
    const controller = new AbortController();
    const schedule = () => {
      if (!alive) return;
      // Потолок ожидания применяется и к ошибкам сети — иначе при лежащем
      // API спиннер и запросы крутились бы вечно.
      if (Date.now() - startedAt > 60_000) {
        setProcessingPayment(false);
        pushToast(t('plans.paymentTimeout'), 'default');
        return;
      }
      pollRef.current = window.setTimeout(poll, 2500);
    };
    const poll = () => {
      void billingApi
        .subscription(controller.signal)
        .then((sub) => {
          if (!alive) return;
          // Успех — только когда подписка реально пришла от провайдера:
          // сравнение с 'Free' давало ложный мгновенный успех пользователям,
          // у которых уже был платный план без LS (dev-активации).
          if (sub.provider === 'lemonsqueezy' && sub.plan !== 'Free') {
            setProcessingPayment(false);
            setJustBought(sub.plan);
            clearAsyncCache();
            limits.reload();
            pushToast(t('plans.paymentDone', { plan: sub.plan }), 'success');
            return;
          }
          schedule();
        })
        .catch(() => schedule());
    };
    poll();
    return () => {
      alive = false;
      controller.abort();
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingPayment]);

  return (
    <div className={styles.page}>
      <TopBar title={t('plans.topTitle')} right={<CountrySelector />} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.plansHead} ref={useReveal()}>
            <h1 className={styles.plansTitle}>{t('plans.title')}</h1>
            <p className={styles.plansSub}>
              {t('plans.sub1')}
              <br />
              {t('plans.sub2')}
            </p>

            <div className={styles.billingToggle} role="tablist" aria-label={t('plans.periodAria')}>
              <button
                type="button"
                role="tab"
                aria-selected={period === 'monthly'}
                className={`${styles.billingOpt} ${period === 'monthly' ? styles.billingOptActive : ''}`}
                onClick={() => setPeriod('monthly')}
              >
                {t('plans.monthly')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={period === 'yearly'}
                className={`${styles.billingOpt} ${period === 'yearly' ? styles.billingOptActive : ''}`}
                onClick={() => setPeriod('yearly')}
              >
                {t('plans.yearly')}
                <span className={styles.billingSave}>−15%</span>
              </button>
            </div>
          </div>
          {processingPayment ? (
            <div className={styles.paymentProcessing} role="status">
              <Spinner size={16} />
              {t('plans.paymentProcessing')}
            </div>
          ) : null}
          <div className={styles.planRow}>
            {firstFour.map((p, i) => (
              <PlanCard
                key={p.name}
                plan={p}
                period={period}
                current={p.name === currentPlan}
                currentPeriod={subscription.data?.period ?? null}
                lsManaged={subscription.data?.provider === 'lemonsqueezy'}
                onPurchased={setJustBought}
                delay={0.08 + i * 0.08}
              />
            ))}
          </div>
          <PlanCard plan={enterprise} period={period} wide onPurchased={setJustBought} delay={0.4} />
        </div>
      </div>
    </div>
  );
}
