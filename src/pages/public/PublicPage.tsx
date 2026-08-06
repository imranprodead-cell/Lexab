/**
 * Один рендерер для всех публичных страниц-разделов.
 *
 * Страница приходит данными (src/content/pages/*.ts) и рисуется общим набором
 * блоков — поэтому 13 разделов получают одинаковый каркас, одинаковое
 * поведение в RTL и тёмной теме и одинаковую разметку для поисковика, а
 * добавление страницы стоит одного файла контента.
 *
 * ЖЁСТКИЕ ПРАВИЛА ЭТОГО ФАЙЛА И ЕГО CSS (бюджет веса и корректность):
 *  - НЕ импортировать `motion/react` — это 48.7 КБ gzip на первую загрузку.
 *    Появление блоков делает существующий useReveal (IntersectionObserver).
 *  - НЕ импортировать компоненты лендинга: они тянут за собой анимации.
 *  - Только логические CSS-свойства (margin-inline, text-align: start) —
 *    иначе арабская версия зеркалится неправильно.
 *  - Ни одного литерального цвета в JS: тема применяется предпаинтовым
 *    скриптом, снимок пререндера обязан краситься переменными сам.
 */
import { Link } from 'react-router-dom';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicFooter } from '@/components/public/PublicFooter';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useI18n } from '@/i18n/I18nProvider';
import { SITE_PLANS } from '@/content/site/plans';
import type { Block, CtaLink, PageContent, Text6 } from '@/content/types';
import styles from './publicPage.module.css';

const isExternal = (to: string) => /^https?:\/\//.test(to);

function CtaRow({ items, t }: { items: CtaLink[]; t: (v: Text6) => string }) {
  return (
    <div className={styles.ctaRow}>
      {items.map((item) => {
        const cls = `${styles.cta} ${item.variant === 'secondary' ? styles.ctaSecondary : styles.ctaPrimary}`;
        return isExternal(item.to) ? (
          <a key={item.to} className={cls} href={item.to} target="_blank" rel="noopener noreferrer">
            {t(item.label)}
          </a>
        ) : (
          <Link key={item.to} className={cls} to={item.to}>
            {t(item.label)}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Таблица тарифов. Числа приходят из SITE_PLANS (src/content/site/plans.ts),
 * который тестом сцеплен с серверными лимитами, — вписать сюда цифру руками
 * негде, и разойтись ей не с чем. Из контента берутся только слова.
 */
function PlansTable({
  block,
  t,
  innerRef,
}: {
  block: Extract<Block, { kind: 'plans' }>;
  t: (v: Text6) => string;
  innerRef: ReturnType<typeof useReveal>;
}) {
  const { lang } = useI18n();
  // Разряды разделяем узким пробелом: «10 000» читается, «10000» — нет.
  const num = (n: number) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ru-RU').format(n);
  const storage = (mb: number | null) => {
    if (mb === null) return t(block.labels.unlimited);
    if (mb >= 1024 * 1024) return `${num(mb / 1024 / 1024)} ТБ`;
    if (mb >= 1024) return `${num(mb / 1024)} ГБ`;
    return `${num(mb)} МБ`;
  };
  const price = (plan: (typeof SITE_PLANS)[number]) => {
    if (plan.monthlyUsd === null) return t(block.labels.custom);
    return `$${num(plan.monthlyUsd)}${t(block.labels.perMonth)}`;
  };

  return (
    <section className={styles.section} ref={innerRef}>
      <h2 className={styles.h2}>{t(block.title)}</h2>
      {block.intro ? <p className={styles.p}>{t(block.intro)}</p> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t(block.columns.plan)}</th>
              <th scope="col">{t(block.columns.price)}</th>
              <th scope="col">{t(block.columns.ai)}</th>
              <th scope="col">{t(block.columns.docs)}</th>
              <th scope="col">{t(block.columns.storage)}</th>
              <th scope="col">{t(block.columns.seats)}</th>
            </tr>
          </thead>
          <tbody>
            {SITE_PLANS.map((plan) => (
              <tr key={plan.id}>
                <th scope="row">{plan.id}</th>
                <td>{price(plan)}</td>
                <td>{plan.limits.ai === null ? t(block.labels.unlimited) : num(plan.limits.ai)}</td>
                <td>{plan.limits.docs === null ? t(block.labels.unlimited) : num(plan.limits.docs)}</td>
                <td>{storage(plan.limits.storageMb)}</td>
                <td>{plan.limits.seats === null ? t(block.labels.unlimited) : num(plan.limits.seats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.tableNote}>{t(block.labels.yearlyNote)}</p>
      {block.note ? <p className={styles.tableNote}>{t(block.note)}</p> : null}
    </section>
  );
}

function BlockView({ block, index, t }: { block: Block; index: number; t: (v: Text6) => string }) {
  // Каскад появления: первые блоки без задержки, дальше по нарастающей, но не
  // более 0.24с — иначе нижние блоки «догоняют» читателя слишком поздно.
  const ref = useReveal(Math.min(index, 3) * 0.08);

  switch (block.kind) {
    case 'hero':
      return (
        <header className={styles.hero} ref={ref}>
          <h1 className={styles.h1}>{t(block.title)}</h1>
          <p className={styles.lead}>{t(block.lead)}</p>
          {block.planNote ? <p className={styles.planNote}>{t(block.planNote)}</p> : null}
          <CtaRow items={block.cta} t={t} />
        </header>
      );

    case 'facts':
      return (
        <section className={styles.section} ref={ref}>
          {block.title ? <h2 className={styles.h2}>{t(block.title)}</h2> : null}
          <div className={styles.factGrid}>
            {block.items.map((item, i) => (
              <div key={i} className={styles.fact}>
                <div className={styles.factValue}>{t(item.value)}</div>
                <div className={styles.factLabel}>{t(item.label)}</div>
                <div className={styles.factProof}>{t(item.proof)}</div>
              </div>
            ))}
          </div>
        </section>
      );

    case 'steps':
      return (
        <section className={styles.section} ref={ref}>
          <h2 className={styles.h2}>{t(block.title)}</h2>
          <ol className={styles.steps}>
            {block.items.map((item, i) => (
              <li key={i} className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <div className={styles.stepTitle}>{t(item.title)}</div>
                  <p className={styles.stepBody}>{t(item.body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      );

    case 'list':
      return (
        <section className={`${styles.section} ${block.tone === 'limits' ? styles.limits : ''}`} ref={ref}>
          <h2 className={styles.h2}>{t(block.title)}</h2>
          {block.intro ? <p className={styles.p}>{t(block.intro)}</p> : null}
          <ul className={styles.list}>
            {block.items.map((item, i) => (
              <li key={i} className={styles.listItem}>
                <span className={styles.listTitle}>{t(item.title)}</span>
                {item.body ? <span className={styles.listBody}> — {t(item.body)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      );

    case 'table':
      return (
        <section className={styles.section} ref={ref}>
          <h2 className={styles.h2}>{t(block.title)}</h2>
          {block.intro ? <p className={styles.p}>{t(block.intro)}</p> : null}
          {/* Обёртка со своим горизонтальным скроллом: страница не должна
              ездить вбок на телефоне из-за широкой таблицы. */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={i} scope="col">
                      {t(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row">
                          {t(cell)}
                        </th>
                      ) : (
                        <td key={j}>{t(cell)}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.note ? <p className={styles.tableNote}>{t(block.note)}</p> : null}
        </section>
      );

    case 'plans':
      return <PlansTable block={block} t={t} innerRef={ref} />;

    case 'prose':
      return (
        <section className={styles.section} ref={ref}>
          {block.title ? <h2 className={styles.h2}>{t(block.title)}</h2> : null}
          {block.paragraphs.map((p, i) => (
            <p key={i} className={styles.p}>
              {t(p)}
            </p>
          ))}
        </section>
      );

    case 'note':
      return (
        <section className={styles.section} ref={ref}>
          <div className={styles.note} role="note">
            {block.title ? <strong className={styles.noteTitle}>{t(block.title)}</strong> : null}
            <p className={styles.noteBody}>{t(block.body)}</p>
          </div>
        </section>
      );

    case 'faq':
      return (
        <section className={styles.section} ref={ref}>
          <h2 className={styles.h2}>{t(block.title)}</h2>
          <div className={styles.faq}>
            {block.items.map((item, i) => (
              // <details>, а не аккордеон на состоянии: работает без JS и
              // попадает в пререндеренный HTML как читаемый текст.
              <details key={i} className={styles.faqItem}>
                <summary className={styles.faqQ}>{t(item.q)}</summary>
                <p className={styles.faqA}>{t(item.a)}</p>
              </details>
            ))}
          </div>
        </section>
      );

    case 'related':
      return (
        <section className={styles.section} ref={ref}>
          <h2 className={styles.h2}>{t(block.title)}</h2>
          <div className={styles.relatedGrid}>
            {block.items.map((item) => (
              <Link key={item.to} to={item.to} className={styles.relatedCard}>
                <span className={styles.relatedTitle}>{t(item.title)}</span>
                <span className={styles.relatedBody}>{t(item.body)}</span>
              </Link>
            ))}
          </div>
        </section>
      );

    case 'cta':
      return (
        <section className={styles.section} ref={ref}>
          <div className={styles.ctaBlock}>
            <h2 className={styles.h2}>{t(block.title)}</h2>
            {block.body ? <p className={styles.p}>{t(block.body)}</p> : null}
            <CtaRow items={block.cta} t={t} />
          </div>
        </section>
      );
  }
}

export function PublicPage({ content }: { content: PageContent }) {
  const { lang } = useI18n();
  const t = (value: Text6) => value[lang];
  usePageTitle(t(content.pageTitle));

  return (
    // data-prerender-ready — единый селектор ожидания для scripts/prerender.mjs:
    // снимок делается, когда страница действительно отрисована.
    <div className={styles.page} data-prerender-ready="true">
      <PublicHeader activeSlug={content.slug} />
      <main className={styles.inner}>
        {content.blocks.map((block, i) => (
          <BlockView key={i} block={block} index={i} t={t} />
        ))}
      </main>
      <PublicFooter />
    </div>
  );
}
