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
import { pickText } from '@/i18n/messages';
import styles from './pages.module.css';

/** Yearly billing discount (also applied by POST /billing/checkout → Stripe). */
const YEARLY_DISCOUNT = 0.15;

interface Text2 {
  ru: string;
  en: string;
}

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
    price: { ru: '$0', en: '$0' },
    monthly: 0,
    cta: { ru: 'Начало работы', en: 'Get started' },
    tagline: { ru: 'Узнайте, что Lexab может сделать для вас', en: 'See what Lexab can do for you' },
    features: [
      { ru: '10 AI-запросов в месяц', en: '10 AI requests per month' },
      { ru: 'До 3 документов', en: 'Up to 3 documents' },
      { ru: 'AI Chat с документами', en: 'AI Chat with documents' },
      { ru: 'AI Summary', en: 'AI Summary' },
      { ru: 'Экспорт в PDF', en: 'PDF export' },
    ],
  },
  {
    name: 'Standard',
    dot: '#3FB8AF',
    price: { ru: '$15', en: '$15' },
    monthly: 15,
    cta: { ru: 'Перейти в Standard', en: 'Upgrade to Standard' },
    tagline: { ru: 'Для студентов, фрилансеров и стартапов', en: 'For students, freelancers and startups' },
    features: [
      { ru: 'До 100 AI-запросов в месяц', en: 'Up to 100 AI requests per month' },
      { ru: 'До 20 документов в месяц', en: 'Up to 20 documents per month' },
      { ru: 'AI Chat с документами', en: 'AI Chat with documents' },
      { ru: 'AI Contract Generator', en: 'AI Contract Generator' },
      { ru: 'AI Risk Analysis', en: 'AI Risk Analysis' },
      { ru: 'AI Summary', en: 'AI Summary' },
      { ru: 'Экспорт в PDF и DOCX', en: 'PDF & DOCX export' },
      { ru: '2 GB защищённого хранилища', en: '2 GB secure storage' },
      { ru: 'Email-поддержка', en: 'Email support' },
    ],
  },
  {
    name: 'Pro',
    dot: '#5B8DEF',
    price: { ru: '$50', en: '$50' },
    monthly: 50,
    accent: true,
    popular: true,
    cta: { ru: 'Перейти в Pro', en: 'Upgrade to Pro' },
    tagline: { ru: 'Для юристов и малого бизнеса', en: 'For lawyers and small businesses' },
    inherits: { ru: 'Всё из Standard, плюс:', en: 'Everything in Standard, plus:' },
    features: [
      { ru: 'Безлимитные AI-чаты', en: 'Unlimited AI chats' },
      { ru: 'До 80 документов в месяц', en: 'Up to 80 documents per month' },
      { ru: 'Redline (сравнение версий)', en: 'Redline (version compare)' },
      { ru: 'AI Contract Review', en: 'AI Contract Review' },
      { ru: 'AI Clause Suggestions', en: 'AI Clause Suggestions' },
      { ru: 'Version History', en: 'Version History' },
      { ru: 'Электронная подпись', en: 'E-signature' },
      { ru: 'Маршруты согласования (цепочки утверждения с дедлайнами)', en: 'Approval workflows (multi-step sign-off with deadlines)' },
      { ru: '50 GB защищённого хранилища', en: '50 GB secure storage' },
      { ru: 'Приоритетная поддержка', en: 'Priority support' },
      { ru: 'Ранний доступ к новым функциям', en: 'Early access to new features' },
    ],
  },
  {
    name: 'Business',
    dot: '#8B7CF6',
    price: { ru: '$499', en: '$499' },
    monthly: 499,
    yearlyTotal: 5000,
    cta: { ru: 'Перейти в Business', en: 'Upgrade to Business' },
    tagline: { ru: 'Для юридических фирм и компаний', en: 'For law firms and companies' },
    inherits: { ru: 'Всё из Pro, плюс:', en: 'Everything in Pro, plus:' },
    features: [
      { ru: 'Доступ к самым мощным AI-моделям', en: 'Access to the most capable AI models' },
      { ru: 'До 5 пользователей', en: 'Up to 5 users' },
      { ru: 'До 700 документов в месяц', en: 'Up to 700 documents per month' },
      { ru: 'Общие Workspaces', en: 'Shared workspaces' },
      { ru: 'Управление ролями и правами доступа', en: 'Roles & access management' },
      { ru: 'Совместная работа над документами', en: 'Document collaboration' },
      { ru: 'Audit Log', en: 'Audit log' },
      { ru: 'API-доступ (1000 анализов/мес)', en: 'API access (1,000 analyses/mo)' },
      { ru: 'Расширенная аналитика', en: 'Advanced analytics' },
      { ru: 'SSO (Single Sign-On)', en: 'SSO (Single Sign-On)' },
      { ru: '1 TB защищённого хранилища', en: '1 TB secure storage' },
      { ru: 'Выделенный Customer Success Manager', en: 'Dedicated Customer Success Manager' },
    ],
  },
  {
    name: 'Enterprise',
    dot: '#9A9AA6',
    price: { ru: 'По договорённости', en: 'Custom pricing' },
    cta: { ru: 'Связаться', en: 'Contact us' },
    tagline: { ru: 'Индивидуальные условия и внедрение — по созвону.', en: 'Custom terms and onboarding — book a call.' },
    features: [
      { ru: 'Безлимитные пользователи и документы', en: 'Unlimited users and documents' },
      { ru: 'Приватные / self-hosted AI-модели', en: 'Private / self-hosted AI models' },
      { ru: 'Кастомные интеграции и API', en: 'Custom integrations and API' },
      { ru: 'Персональный SLA и поддержка 24/7', en: 'Personal SLA and 24/7 support' },
      { ru: 'Юридический on-boarding команды', en: 'Legal onboarding for your team' },
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
