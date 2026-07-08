import { TopBar } from '@/components/layout/TopBar';
import { CountrySelector } from '@/components/layout/CountrySelector';
import { Icon } from '@/components/icons/Icon';
import { useUIStore } from '@/store/useUIStore';
import styles from './pages.module.css';

interface Plan {
  name: string;
  dot: string;
  price: string;
  per?: string;
  accent?: boolean;
  badge?: string;
  cta: string;
  tagline: string;
  inherits?: string;
  features: string[];
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    dot: '#5F5F6A',
    price: '$0',
    per: '/ мес',
    cta: 'Начало работы',
    tagline: 'Узнайте, что LexAI может сделать для вас',
    features: ['10 AI-запросов в месяц', 'До 3 документов', 'AI Chat с документами', 'AI Summary', 'Экспорт в PDF'],
  },
  {
    name: 'Standard',
    dot: '#3FB8AF',
    price: '$15',
    per: '/ мес',
    cta: 'Перейти в Standard',
    tagline: 'Для студентов, фрилансеров и стартапов',
    features: [
      'До 100 AI-запросов в месяц',
      'До 20 документов в месяц',
      'AI Chat с документами',
      'AI Contract Generator',
      'AI Risk Analysis',
      'AI Summary',
      'Экспорт в PDF и DOCX',
      '2 GB защищённого хранилища',
      'Email-поддержка',
    ],
  },
  {
    name: 'Pro',
    dot: '#5B8DEF',
    price: '$50',
    per: '/ мес',
    accent: true,
    badge: 'Популярный',
    cta: 'Перейти в Pro',
    tagline: 'Для юристов и малого бизнеса',
    inherits: 'Всё из Standard, плюс:',
    features: [
      'Безлимитные AI-чаты',
      'До 80 документов в месяц',
      'Redline (сравнение версий)',
      'AI Contract Review',
      'AI Clause Suggestions',
      'Version History',
      'Электронная подпись',
      '50 GB защищённого хранилища',
      'Приоритетная поддержка',
      'Ранний доступ к новым функциям',
    ],
  },
  {
    name: 'Business',
    dot: '#8B7CF6',
    price: '$499',
    per: '/ мес',
    cta: 'Перейти в Business',
    tagline: 'Для юридических фирм и компаний',
    inherits: 'Всё из Pro, плюс:',
    features: [
      'Доступ к самым мощным AI-моделям',
      'До 5 пользователей',
      'До 700 документов в месяц',
      'Общие Workspaces',
      'Управление ролями и правами доступа',
      'Совместная работа над документами',
      'Интеграции (Google Drive, Microsoft 365, Dropbox)',
      'Audit Log',
      'Расширенная аналитика',
      'SSO (Single Sign-On)',
      '1 TB защищённого хранилища',
      'Выделенный Customer Success Manager',
    ],
  },
  {
    name: 'Enterprise',
    dot: '#9A9AA6',
    price: 'По договорённости',
    cta: 'Связаться',
    tagline: 'Индивидуальные условия и внедрение — по созвону.',
    features: [
      'Безлимитные пользователи и документы',
      'Приватные / self-hosted AI-модели',
      'Кастомные интеграции и API',
      'Персональный SLA и поддержка 24/7',
      'Юридический on-boarding команды',
    ],
  },
];

function PlanCard({ plan, wide, current }: { plan: Plan; wide?: boolean; current?: boolean }) {
  const pushToast = useUIStore((s) => s.pushToast);
  const longPrice = plan.price.length > 6;
  return (
    <div className={`${styles.planCard} ${plan.accent ? styles.planCardAccent : ''} ${wide ? styles.planWide : ''}`}>
      {plan.badge && !current ? <span className={styles.planBadge}>{plan.badge}</span> : null}
      {current ? <span className={styles.planBadge}>Самый выгодный</span> : null}
      <div>
        <div className={styles.planName}>
          <span className={styles.planDot} style={{ background: plan.dot }} />
          {plan.name}
        </div>
        <div className={styles.planTagline}>{plan.tagline}</div>
      </div>
      <div className={styles.planPrice}>
        <span className={`${styles.planPriceValue} ${longPrice ? styles.planPriceValueSm : ''}`}>{plan.price}</span>
        {plan.per ? <span className={styles.planPer}>{plan.per}</span> : null}
      </div>
      {plan.inherits ? <div className={styles.planInherits}>{plan.inherits}</div> : null}
      <div className={styles.planFeatures}>
        {plan.features.map((f) => (
          <div key={f} className={styles.planFeature}>
            <span className={styles.planCheck}>
              <Icon name="check" size={10} strokeWidth={2.6} />
            </span>
            {f}
          </div>
        ))}
      </div>
      <button
        className={`${styles.planCta} ${plan.accent && !current ? styles.planCtaAccent : ''}`}
        disabled={current}
        style={current ? { opacity: 0.6, cursor: 'default' } : undefined}
        onClick={() =>
          current
            ? undefined
            : pushToast(
                plan.name === 'Enterprise'
                  ? 'Мы свяжемся с вами для обсуждения условий.'
                  : `Оформление плана ${plan.name} — подключите биллинг-эндпоинт.`,
                'success',
              )
        }
      >
        {current ? 'Ваш план' : plan.cta}
      </button>
    </div>
  );
}

/** Full-page pricing view (Free / Standard / Pro / Business in a row, Enterprise below). */
export function PlansPage() {
  const firstFour = PLANS.slice(0, 4);
  const enterprise = PLANS[4];
  return (
    <div className={styles.page}>
      <TopBar title="Тарифы" right={<CountrySelector />} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.plansHead}>
            <h1 className={styles.plansTitle}>Plans</h1>
            <p className={styles.plansSub}>
              Choose the plan that fits your legal workflow.
              <br />
              Start for free and upgrade as your team grows.
            </p>
          </div>
          <div className={styles.planRow}>
            {firstFour.map((p) => (
              <PlanCard key={p.name} plan={p} current={p.name === 'Pro'} />
            ))}
          </div>
          <PlanCard plan={enterprise} wide />
        </div>
      </div>
    </div>
  );
}
