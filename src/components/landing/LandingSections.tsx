import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { useI18n } from '@/i18n/I18nProvider';
import { prefersReducedMotion, scrollBehavior } from '@/lib/scroll';
import { LandingDemo, DEMO_NOTE } from './LandingDemo';
import styles from './landing.module.css';

/** Bilingual copy lives next to the markup (same idiom as PlansPage.PLANS). */
type Text2 = { ru: string; en: string };

const TELEGRAM_URL = 'https://t.me/MANAGER_CIVIS';

interface SectionHead {
  eyebrow: Text2;
  title: Text2;
  sub: Text2;
}

const HEADS: Record<string, SectionHead> = {
  features: {
    eyebrow: { ru: 'Возможности', en: 'Features' },
    title: { ru: 'Что умеет LexAI', en: 'What LexAI does' },
    sub: {
      ru: 'Анализ, правки, проверяемые цитаты и экспорт — полный цикл работы с договором.',
      en: 'Analysis, redlines, verifiable citations and export — the full contract workflow.',
    },
  },
  how: {
    eyebrow: { ru: 'Процесс', en: 'Process' },
    title: { ru: 'Как это работает', en: 'How it works' },
    sub: {
      ru: 'От загрузки до готового документа — четыре шага.',
      en: 'From upload to final document in four steps.',
    },
  },
  demo: {
    eyebrow: { ru: 'Демо', en: 'Demo' },
    title: { ru: 'Так выглядит анализ', en: 'What a review looks like' },
    sub: {
      ru: 'Пример того, что вы получаете по каждому рискованному пункту.',
      en: 'An example of what you get for every risky clause.',
    },
  },
  solutions: {
    eyebrow: { ru: 'Для кого', en: 'Who it’s for' },
    title: { ru: 'Кому полезен LexAI', en: 'Who LexAI helps' },
    sub: {
      ru: 'От юрфирм до частных лиц — везде, где договоры отнимают время.',
      en: 'From law firms to individuals — wherever contracts eat time.',
    },
  },
  security: {
    eyebrow: { ru: 'Безопасность', en: 'Security' },
    title: { ru: 'Ваши документы — под вашим контролем', en: 'Your documents, under your control' },
    sub: {
      ru: 'Для юридического продукта это не опция. Вот как LexAI обращается с данными — честно и по делу.',
      en: 'For a legal product this isn’t optional. Here is how LexAI handles your data — plainly and honestly.',
    },
  },
  plans: {
    eyebrow: { ru: 'Тарифы', en: 'Pricing' },
    title: { ru: 'Планы под ваш объём работы', en: 'Plans for your workload' },
    sub: {
      ru: 'Начните бесплатно — карта не нужна. При годовой оплате — скидка 15%.',
      en: 'Start free — no card required. Annual billing saves 15%.',
    },
  },
  faq: {
    eyebrow: { ru: 'FAQ', en: 'FAQ' },
    title: { ru: 'Частые вопросы', en: 'Frequently asked questions' },
    sub: {
      ru: 'Коротко и честно — о безопасности, анализе и старте.',
      en: 'Short, honest answers about security, analysis and getting started.',
    },
  },
};

const FEATURES: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'alert',
    title: { ru: 'Анализ договоров', en: 'Contract analysis' },
    text: {
      ru: 'Загрузите договор — LexAI разберёт его по пунктам и отметит риски: высокий, средний, низкий.',
      en: 'Upload a contract — LexAI reviews it clause by clause and flags risks as high, medium or low.',
    },
  },
  {
    icon: 'pen',
    title: { ru: 'Редлайнинг', en: 'Redlining' },
    text: {
      ru: 'ИИ предлагает конкретные правки: что убрать и чем заменить. Каждую можно принять или отклонить.',
      en: 'The AI drafts concrete edits: what to remove and what to put instead. Accept or reject each one.',
    },
  },
  {
    icon: 'shield',
    title: { ru: 'Цитаты на законодательство', en: 'Legal citations' },
    text: {
      ru: 'Каждый вывод подкреплён ссылкой на конкретную норму. Цитаты автоматически сверяются с официальными текстами законов.',
      en: 'Every finding is backed by a reference to a specific provision, automatically checked against official law texts.',
    },
  },
  {
    icon: 'download',
    title: { ru: 'Экспорт в DOCX и PDF', en: 'DOCX & PDF export' },
    text: {
      ru: 'Документ с принятыми правками скачивается в DOCX или PDF — форматирование сохраняется, файл открывается в Word.',
      en: 'Download the document with accepted edits as DOCX or PDF — formatting preserved, opens in Word.',
    },
  },
];

const STEPS: { title: Text2; text: Text2 }[] = [
  {
    title: { ru: 'Загрузите договор', en: 'Upload your contract' },
    text: {
      ru: 'Или вставьте текст прямо в чат — LexAI работает с вашими документами.',
      en: 'Or paste the text straight into the chat — LexAI works with your documents.',
    },
  },
  {
    title: { ru: 'ИИ находит риски', en: 'The AI finds risks' },
    text: {
      ru: 'Разбор по пунктам: что опасно, почему и насколько это серьёзно.',
      en: 'A clause-by-clause breakdown: what is risky, why, and how serious it is.',
    },
  },
  {
    title: { ru: 'Проверяете цитаты', en: 'Verify the citations' },
    text: {
      ru: 'Каждый вывод — со ссылкой на норму закона, которую можно открыть и проверить.',
      en: 'Every finding cites a legal provision you can open and check yourself.',
    },
  },
  {
    title: { ru: 'Принимаете правки', en: 'Accept the redlines' },
    text: {
      ru: 'Примите или отклоните предложенные правки и экспортируйте готовый документ.',
      en: 'Accept or reject the suggested edits and export the final document.',
    },
  },
];

const SOLUTIONS: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'users',
    title: { ru: 'Юридические фирмы', en: 'Law firms' },
    text: {
      ru: 'Рутинная вычитка уходит ИИ — юристы занимаются позицией клиента, а не перечитыванием типовых пунктов.',
      en: 'Routine review goes to the AI — lawyers spend time on the client’s position, not on re-reading boilerplate.',
    },
  },
  {
    icon: 'layout',
    title: { ru: 'Юротделы компаний', en: 'In-house legal teams' },
    text: {
      ru: 'Общие документы, роли доступа и маршруты согласования — договор проходит цепочку быстрее.',
      en: 'Shared documents, access roles and approval workflows — contracts move through the chain faster.',
    },
  },
  {
    icon: 'analytics',
    title: { ru: 'Компании с потоком договоров', en: 'High-volume teams' },
    text: {
      ru: 'Десятки договоров в месяц: шаблоны, история версий и аналитика рисков в одном месте.',
      en: 'Dozens of contracts a month: templates, version history and risk analytics in one place.',
    },
  },
  {
    icon: 'chat',
    title: { ru: 'Частные лица', en: 'Individuals' },
    text: {
      ru: 'Аренда, оферта, трудовой договор — понятный разбор без юридического жаргона.',
      en: 'A lease, an offer, an employment contract — a clear breakdown without legal jargon.',
    },
  },
];

/** Every claim below is implemented in the product — no marketing invention. */
const SECURITY: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'shield',
    title: { ru: 'Приватное хранилище', en: 'Private storage' },
    text: {
      ru: 'Файлы хранятся в приватном облачном хранилище; доступ — только по временным подписанным ссылкам.',
      en: 'Files live in a private cloud bucket; access is via expiring signed links only.',
    },
  },
  {
    icon: 'eyeOff',
    title: { ru: 'Без обучения на ваших данных', en: 'No training on your data' },
    text: {
      ru: 'Документы не используются для обучения моделей и не передаются третьим лицам. Условия наших ИИ-провайдеров исключают обучение моделей на переданных данных.',
      en: 'Your documents are not used to train models and are not shared with third parties. Our AI providers’ terms preclude training models on submitted data.',
    },
  },
  {
    icon: 'users',
    title: { ru: 'Доступ контролируете вы', en: 'You control access' },
    text: {
      ru: 'По умолчанию документ видите только вы. На тарифе Business его можно открыть команде — с ролями: администратор, редактор, просмотр.',
      en: 'By default only you can see a document. On the Business plan you can share it with your team — with admin, editor or viewer roles.',
    },
  },
  {
    icon: 'check',
    title: { ru: 'Проверяемые цитаты', en: 'Verifiable citations' },
    text: {
      ru: 'Ссылки на законы проверяются кодом по официальным источникам — legislation.gov.uk и lex.uz. Неподтверждённое помечается.',
      en: 'Legal citations are validated in code against official sources — legislation.gov.uk and lex.uz. Anything unconfirmed is flagged.',
    },
  },
  {
    icon: 'trash',
    title: { ru: 'Удаление в один клик', en: 'One-click deletion' },
    text: {
      ru: 'Удалите документ — он исчезнет из аккаунта и базы данных. Можно удалить и аккаунт целиком вместе со всеми данными.',
      en: 'Delete a document and it disappears from your account and the database. You can also delete your entire account with all its data.',
    },
  },
];

interface LandingPlan {
  name: string;
  dot: string;
  /** Monthly price in USD; yearly billing shows it with the 15% discount. */
  monthly: number;
  popular?: boolean;
  tagline: Text2;
  features: Text2[];
}

/** Mirrors the in-app Plans page (same numbers, gates and 15% yearly discount). */
const YEARLY_DISCOUNT = 0.15;

const PLANS: LandingPlan[] = [
  {
    name: 'Free',
    dot: '#5F5F6A',
    monthly: 0,
    tagline: { ru: 'Понять, что умеет LexAI', en: 'See what LexAI can do' },
    features: [
      { ru: '10 AI-запросов в месяц', en: '10 AI requests per month' },
      { ru: 'До 3 документов', en: 'Up to 3 documents' },
      { ru: 'AI-чат с документами', en: 'AI chat with documents' },
      { ru: 'Экспорт в PDF', en: 'PDF export' },
      { ru: '100 МБ хранилища', en: '100 MB storage' },
    ],
  },
  {
    name: 'Standard',
    dot: '#3FB8AF',
    monthly: 15,
    tagline: { ru: 'Студентам, фрилансерам, стартапам', en: 'For students, freelancers and startups' },
    features: [
      { ru: '100 AI-запросов в месяц', en: '100 AI requests per month' },
      { ru: 'До 20 документов в месяц', en: 'Up to 20 documents per month' },
      { ru: 'Генератор договоров', en: 'Contract generator' },
      { ru: 'Экспорт в DOCX и PDF', en: 'DOCX & PDF export' },
      { ru: '2 ГБ хранилища', en: '2 GB storage' },
    ],
  },
  {
    name: 'Pro',
    dot: '#5B8DEF',
    monthly: 50,
    popular: true,
    tagline: { ru: 'Юристам и малому бизнесу', en: 'For lawyers and small businesses' },
    features: [
      { ru: 'Безлимитные AI-чаты', en: 'Unlimited AI chats' },
      { ru: 'До 80 документов в месяц', en: 'Up to 80 documents per month' },
      { ru: 'Сравнение версий (Redline)', en: 'Version compare (Redline)' },
      { ru: 'Э-подпись и маршруты согласования', en: 'E-signature and approval workflows' },
      { ru: '50 ГБ хранилища', en: '50 GB storage' },
    ],
  },
  {
    name: 'Business',
    dot: '#8B7CF6',
    monthly: 499,
    tagline: { ru: 'Юрфирмам и компаниям', en: 'For law firms and companies' },
    features: [
      { ru: 'Всё из Pro, до 5 пользователей', en: 'Everything in Pro, up to 5 users' },
      { ru: 'Команды и общие документы', en: 'Teams and shared documents' },
      { ru: 'До 700 документов в месяц', en: 'Up to 700 documents per month' },
      { ru: 'Самые мощные AI-модели', en: 'The most capable AI models' },
      { ru: '1 ТБ хранилища', en: '1 TB storage' },
    ],
  },
];

interface FaqItem {
  q: Text2;
  a: Text2;
  /** Optional in-page link rendered under the answer. */
  link?: { id: string; label: Text2 };
}

const FAQ_GROUPS: { title: Text2; items: FaqItem[] }[] = [
  {
    title: { ru: 'Безопасность и конфиденциальность', en: 'Security & privacy' },
    items: [
      {
        q: { ru: 'Что происходит с моими договорами после загрузки?', en: 'What happens to my contracts after upload?' },
        a: {
          ru: 'Файл сохраняется в приватном облачном хранилище (доступ — только по временным подписанным ссылкам), извлечённый текст — в защищённой базе данных. Документ используется только для анализа по вашему запросу. Удалить его — или весь аккаунт со всеми данными — можно в любой момент.',
          en: 'The file is stored in a private cloud bucket (accessible only via expiring signed links) and the extracted text in a protected database. It is used only for the analysis you request. You can delete a document — or your whole account with all its data — at any time.',
        },
      },
      {
        q: { ru: 'Вы используете мои документы для обучения ИИ?', en: 'Do you use my documents to train the AI?' },
        a: {
          ru: 'Нет. Документы не используются для обучения моделей и не передаются третьим лицам.',
          en: 'No. Your documents are not used for model training and are not shared with third parties.',
        },
      },
      {
        q: { ru: 'Кто может видеть мои документы?', en: 'Who can see my documents?' },
        a: {
          ru: 'Только вы. На тарифе Business документ можно открыть своей команде: вы сами приглашаете коллег и назначаете роли — администратор, редактор или просмотр. Без вашего решения документ не увидит никто.',
          en: 'Only you. On the Business plan you can share a document with your team: you invite colleagues yourself and assign roles — admin, editor or viewer. Nobody sees a document unless you decide so.',
        },
      },
    ],
  },
  {
    title: { ru: 'Как работает анализ', en: 'How the analysis works' },
    items: [
      {
        q: { ru: 'Можно ли доверять выводам ИИ? Он не ошибается?', en: 'Can I trust the AI’s conclusions? Doesn’t it make mistakes?' },
        a: {
          ru: 'LexAI не даёт «мнение из воздуха»: каждый вывод сопровождается ссылкой на конкретную норму, которую можно открыть и проверить самостоятельно. Цитаты автоматически сверяются с базой официальных текстов; не прошедшие проверку помечаются как неподтверждённые. ИИ — ускоритель работы, финальное решение всегда за юристом.',
          en: 'LexAI doesn’t give opinions out of thin air: every finding comes with a reference to a specific provision you can open and verify. Citations are automatically checked against a corpus of official texts; anything that fails the check is flagged as unverified. The AI speeds up the work — the final call is always the lawyer’s.',
        },
      },
      {
        q: { ru: 'Что значит «ссылки на законодательство»?', en: 'What do “legal citations” mean?' },
        a: {
          ru: 'Если система отмечает рискованный пункт, она показывает не просто «это плохо», а ссылку на статью закона, из-за которой пункт является рискованным. Тексты норм попадают в базу только из официальных источников — legislation.gov.uk и lex.uz, — поэтому система не может «придумать» несуществующую норму, как обычный чат-бот.',
          en: 'When the system flags a risky clause, it doesn’t just say “this is bad” — it shows the specific statutory provision that makes the clause risky. Law texts enter the corpus only from official sources — legislation.gov.uk and lex.uz — so the system cannot “invent” a non-existent provision the way a generic chatbot can.',
        },
      },
      {
        q: { ru: 'С законодательством каких стран вы работаете?', en: 'Which countries’ legislation do you cover?' },
        a: {
          ru: 'Сейчас — Великобритания и Узбекистан. Казахстан — следующий модуль. Новые юрисдикции подключаются как отдельные модули.',
          en: 'Currently the United Kingdom and Uzbekistan. Kazakhstan is the next module. New jurisdictions are added as separate modules.',
        },
      },
      {
        q: { ru: 'LexAI заменяет юриста?', en: 'Does LexAI replace a lawyer?' },
        a: {
          ru: 'Нет. Он берёт на себя рутину — вычитку, поиск рисков, редлайнинг, — чтобы юрист тратил время на решения, а не на перечитывание типовых пунктов.',
          en: 'No. It takes over the routine — proofreading, risk-spotting, redlining — so the lawyer spends time on decisions rather than re-reading boilerplate.',
        },
      },
    ],
  },
  {
    title: { ru: 'Практика и старт', en: 'Getting started' },
    items: [
      {
        q: { ru: 'На каком языке работает система?', en: 'What languages does it work in?' },
        a: {
          ru: 'Интерфейс — на русском и английском. ИИ отвечает на языке вашего вопроса. Корпус законов Великобритании — на английском, Узбекистана — официальная русская версия lex.uz.',
          en: 'The interface is in Russian and English. The AI replies in the language of your question. The UK law corpus is in English; the Uzbekistan corpus uses the official Russian version from lex.uz.',
        },
      },
      {
        q: { ru: 'Можно ли работать в привычном Word?', en: 'Can I keep working in Word?' },
        a: {
          ru: 'Да: документ с принятыми правками экспортируется в DOCX с сохранением форматирования и открывается в Word (есть и PDF). Отдельной надстройки внутри Word пока нет.',
          en: 'Yes: the document with accepted edits exports to DOCX with formatting preserved and opens in Word (PDF is available too). There is no in-Word add-in yet.',
        },
      },
      {
        q: { ru: 'Как начать? Нужна ли карта?', en: 'How do I start? Do I need a card?' },
        a: {
          ru: 'Зарегистрируйтесь по email или через Google — тариф Free включает 10 AI-запросов и 3 документа в месяц. Банковская карта не нужна.',
          en: 'Sign up with email or Google — the Free plan includes 10 AI requests and 3 documents per month. No bank card required.',
        },
      },
      {
        q: { ru: 'Сколько это стоит?', en: 'How much does it cost?' },
        a: {
          ru: 'Четыре тарифа под разный объём работы — от бесплатного до Business. При годовой оплате — скидка 15%.',
          en: 'Four plans for different workloads — from Free to Business. Annual billing comes with a 15% discount.',
        },
        link: { id: 'plans', label: { ru: 'Открыть тарифы', en: 'See pricing' } },
      },
    ],
  },
];

/** Footer columns: section anchors, verifiable sources, contacts, legal. */
const FOOTER_COLS: {
  title: Text2;
  links: { label: Text2; anchor?: string; href?: string; to?: string }[];
}[] = [
  {
    title: { ru: 'Продукт', en: 'Product' },
    links: [
      { label: { ru: 'Возможности', en: 'Features' }, anchor: 'features' },
      { label: { ru: 'Как это работает', en: 'How it works' }, anchor: 'how-it-works' },
      { label: { ru: 'Демо', en: 'Demo' }, anchor: 'demo' },
      { label: { ru: 'Тарифы', en: 'Pricing' }, anchor: 'plans' },
      { label: { ru: 'FAQ', en: 'FAQ' }, anchor: 'faq' },
    ],
  },
  {
    title: { ru: 'Безопасность', en: 'Security' },
    links: [
      { label: { ru: 'Как мы храним данные', en: 'How we store data' }, anchor: 'security' },
      { label: { ru: 'legislation.gov.uk', en: 'legislation.gov.uk' }, href: 'https://www.legislation.gov.uk' },
      { label: { ru: 'lex.uz', en: 'lex.uz' }, href: 'https://lex.uz' },
    ],
  },
  {
    title: { ru: 'Контакты', en: 'Contacts' },
    links: [
      { label: { ru: 'Telegram · @MANAGER_CIVIS', en: 'Telegram · @MANAGER_CIVIS' }, href: TELEGRAM_URL },
      { label: { ru: 'Enterprise — написать нам', en: 'Enterprise — message us' }, href: TELEGRAM_URL },
    ],
  },
  {
    title: { ru: 'Правовое', en: 'Legal' },
    links: [
      { label: { ru: 'Условия использования', en: 'Terms of Use' }, to: '/terms' },
      { label: { ru: 'Политика конфиденциальности', en: 'Privacy Policy' }, to: '/privacy' },
    ],
  },
];

function Head({ id }: { id: keyof typeof HEADS }) {
  const { lang } = useI18n();
  const head = HEADS[id];
  return (
    <div className={styles.head}>
      <div className={styles.eyebrow}>{head.eyebrow[lang]}</div>
      <h2 className={styles.title}>{head.title[lang]}</h2>
      <p className={styles.sub}>{head.sub[lang]}</p>
    </div>
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

  // Scroll-reveal: tag [data-reveal] elements as hidden only when JS runs and
  // motion is allowed, then fade each one in as it enters the viewport.
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

  /** Stagger: each card in a grid enters 60ms after the previous one. */
  const revealAt = (i: number) => ({ '--reveal-delay': `${i * 60}ms` }) as CSSProperties;

  return (
    <>
      {/* ── Возможности ──────────────────────────────────────────────────── */}
      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <Head id="features" />
          <div className={styles.cardsGrid}>
            {FEATURES.map((f, i) => (
              <div key={f.icon} className={styles.card} data-reveal style={revealAt(i)}>
                <span className={styles.cardIcon}>
                  <Icon name={f.icon} size={19} />
                </span>
                <div className={styles.cardTitle}>{f.title[lang]}</div>
                <div className={styles.cardText}>{f.text[lang]}</div>
              </div>
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
              <div key={s.title.en} className={styles.step} data-reveal style={revealAt(i)}>
                <div className={styles.stepNum}>{String(i + 1).padStart(2, '0')}</div>
                <div className={styles.stepTitle}>{s.title[lang]}</div>
                <div className={styles.stepText}>{s.text[lang]}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Демо ─────────────────────────────────────────────────────────── */}
      <section id="demo" className={styles.section}>
        <div className={styles.inner}>
          <Head id="demo" />
          <LandingDemo />
          <div className={styles.demoNote}>{DEMO_NOTE[lang]}</div>
          <div className={styles.centerCta}>
            <button type="button" className={styles.ctaPrimary} onClick={onStart}>
              {t('landing.startFree')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Для кого ─────────────────────────────────────────────────────── */}
      <section id="solutions" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.inner}>
          <Head id="solutions" />
          <div className={styles.cardsGrid}>
            {SOLUTIONS.map((s, i) => (
              <div key={s.icon} className={styles.card} data-reveal style={revealAt(i)}>
                <span className={styles.cardIcon}>
                  <Icon name={s.icon} size={19} />
                </span>
                <div className={styles.cardTitle}>{s.title[lang]}</div>
                <div className={styles.cardText}>{s.text[lang]}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Безопасность ─────────────────────────────────────────────────── */}
      <section id="security" className={styles.section}>
        <div className={styles.inner}>
          <Head id="security" />
          <div className={styles.securityGrid}>
            {SECURITY.map((s, i) => (
              <div key={s.icon} className={styles.securityCard} data-reveal style={revealAt(i)}>
                <span className={styles.securityIcon}>
                  <Icon name={s.icon} size={17} />
                </span>
                <div>
                  <div className={styles.cardTitle}>{s.title[lang]}</div>
                  <div className={styles.cardText}>{s.text[lang]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Тарифы ───────────────────────────────────────────────────────── */}
      <section id="plans" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.inner}>
          <Head id="plans" />

          {/* Billing period — same 15% yearly discount as the in-app page. */}
          <div className={styles.billingToggle} role="group" aria-label={t('landing.nav.plans')}>
            <button
              type="button"
              className={`${styles.billingBtn} ${!yearly ? styles.billingBtnActive : ''}`}
              aria-pressed={!yearly}
              onClick={() => setYearly(false)}
            >
              {t('plans.monthly')}
            </button>
            <button
              type="button"
              className={`${styles.billingBtn} ${yearly ? styles.billingBtnActive : ''}`}
              aria-pressed={yearly}
              onClick={() => setYearly(true)}
            >
              {t('plans.yearly')}
              <span className={styles.billingBadge}>−15%</span>
            </button>
          </div>

          <div className={styles.plansGrid}>
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={`${styles.plan} ${p.popular ? styles.planPopular : ''}`}
                data-reveal
                style={revealAt(i)}
              >
                {p.popular ? (
                  <div className={styles.planBadge}>{lang === 'ru' ? 'Популярный' : 'Popular'}</div>
                ) : null}
                <div className={styles.planName}>
                  <span className={styles.planDot} style={{ background: p.dot }} />
                  {p.name}
                </div>
                <div className={styles.planPrice}>
                  {yearly && p.monthly > 0 ? <span className={styles.planPriceOld}>${p.monthly}</span> : null}
                  ${yearly ? Math.round(p.monthly * (1 - YEARLY_DISCOUNT)) : p.monthly}
                  <span className={styles.planPer}>{lang === 'ru' ? '/мес' : '/mo'}</span>
                </div>
                {yearly && p.monthly > 0 ? (
                  <div className={styles.planPriceNote}>{t('plans.yearlyNote')}</div>
                ) : null}
                <div className={styles.planTagline}>{p.tagline[lang]}</div>
                <ul className={styles.planFeatures}>
                  {p.features.map((f) => (
                    <li key={f.en}>
                      <Icon name="check" size={13} className={styles.planCheck} />
                      {f[lang]}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={p.popular ? styles.ctaPrimary : styles.ctaGhost}
                  onClick={onStart}
                >
                  {p.name === 'Free' ? t('landing.startFree') : t('landing.choosePlan')}
                </button>
              </div>
            ))}
          </div>
          <div className={styles.plansNote}>
            {lang === 'ru' ? (
              <>
                Нужен Enterprise — индивидуальные условия, приватные модели, SLA?{' '}
                <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener">
                  Напишите нам в Telegram
                </a>
                .
              </>
            ) : (
              <>
                Need Enterprise — custom terms, private models, an SLA?{' '}
                <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener">
                  Message us on Telegram
                </a>
                .
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className={styles.section}>
        <div className={styles.inner}>
          <Head id="faq" />
          <div className={styles.faq}>
            {FAQ_GROUPS.map((group) => (
              <div key={group.title.en}>
                <h3 className={styles.faqGroupTitle}>{group.title[lang]}</h3>
                {group.items.map((item) => (
                  <details key={item.q.en} className={styles.faqItem}>
                    <summary className={styles.faqQ}>
                      {item.q[lang]}
                      <span className={styles.faqChevron}>
                        <Icon name="chevron" size={15} />
                      </span>
                    </summary>
                    <div className={styles.faqA}>
                      {item.a[lang]}
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
                          {item.link.label[lang]} →
                        </button>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrandCol}>
            <div className={styles.footerLogo}>
              <Avatar size={30} />
              <span>LexAI</span>
            </div>
            <p className={styles.footerTagline}>{t('auth.tagline')}</p>
            <p className={styles.footerJuris}>
              {lang === 'ru'
                ? 'Юрисдикции: Великобритания · Узбекистан'
                : 'Jurisdictions: United Kingdom · Uzbekistan'}
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <nav key={col.title.en} className={styles.footerCol} aria-label={col.title[lang]}>
              <div className={styles.footerColTitle}>{col.title[lang]}</div>
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
                    {l.label[lang]}
                  </button>
                ) : l.to ? (
                  <Link key={l.label.en} to={l.to} className={styles.footerLink}>
                    {l.label[lang]}
                  </Link>
                ) : (
                  <a
                    key={l.label.en}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.footerLink}
                  >
                    {l.label[lang]}
                  </a>
                ),
              )}
            </nav>
          ))}
        </div>

        <div className={styles.footerBottom}>© {new Date().getFullYear()} LexAI · {t('auth.tagline')}</div>
      </footer>
    </>
  );
}
