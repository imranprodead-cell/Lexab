import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { LogoLoader } from '@/components/ui/LogoLoader';
import { useI18n } from '@/i18n/I18nProvider';
import { prefersReducedMotion } from '@/lib/scroll';
import styles from './landing.module.css';

type Text2 = { ru: string; en: string };

const DEMO = {
  windowTitle: { ru: 'Анализ · договор поставки', en: 'Review · supply agreement' },
  clauseLabel: { ru: 'Пункт 7.2 · Ответственность', en: 'Clause 7.2 · Liability' },
  clauseText: {
    ru: '«Поставщик не несёт ответственности за любые убытки, в том числе возникшие по его небрежности».',
    en: '“The Supplier shall not be liable for any losses, including those caused by its negligence.”',
  },
  severity: { ru: 'Высокий риск', en: 'High risk' },
  findingTitle: { ru: 'Слишком широкое исключение ответственности', en: 'Overly broad liability exclusion' },
  findingText: {
    ru: 'Пункт исключает ответственность даже за небрежность — в таком виде условие может быть недействительным.',
    en: 'The clause excludes liability even for negligence — as written it may be unenforceable.',
  },
  citation: 'Unfair Contract Terms Act 1977, s. 2',
  verified: { ru: 'проверено', en: 'verified' },
  redlineLabel: { ru: 'Предлагаемая правка', en: 'Suggested redline' },
  redlineDel: { ru: 'в том числе возникшие по его небрежности', en: 'including those caused by its negligence' },
  redlineIns: {
    ru: 'за исключением убытков, вызванных его небрежностью или умышленными действиями',
    en: 'except for losses caused by its negligence or wilful misconduct',
  },
  note: {
    ru: 'Иллюстрация анализа LexAI. Результат зависит от документа и юрисдикции.',
    en: 'An illustration of a LexAI review. Actual output depends on the document and jurisdiction.',
  },
} as const satisfies Record<string, Text2 | string>;

/** How far the scripted review has progressed. */
const STEP_THINKING = 1;
const STEP_FINDING = 2;
const STEP_CITATION = 3;
const STEP_REDLINE = 4;

const TYPE_MS = 20; // per character
const PAUSE = { think: 1400, finding: 950, citation: 950, hold: 3200, fadeOut: 350 } as const;

/**
 * Scripted product demo: the clause "types itself", LexAI "thinks" (same
 * loader as the real chat), then the finding, verified citation and redline
 * appear — and the loop restarts. Pure frontend, no AI calls. The loop only
 * runs while visible and is replaced by a static frame under reduced motion.
 */
export function LandingDemo() {
  const { t, lang } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [typedCount, setTypedCount] = useState(0);
  const [step, setStep] = useState(STEP_REDLINE);
  const [fadingOut, setFadingOut] = useState(false);

  const clause = DEMO.clauseText[lang];

  // Static frame for reduced motion / no IntersectionObserver support.
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
    setAnimated(true);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 });
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  // The scripted loop: one chained timeout per phase, cancelled on hide/unmount.
  useEffect(() => {
    if (!animated || !visible) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const at = (ms: number, fn: () => void) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    let chars = 0;
    const cycle = () => {
      setFadingOut(false);
      setStep(0);
      setTypedCount(0);
      chars = 0;
      const typeNext = () => {
        chars += 1;
        setTypedCount(chars);
        if (chars < clause.length) at(TYPE_MS, typeNext);
        else {
          setStep(STEP_THINKING);
          at(PAUSE.think, () => {
            setStep(STEP_FINDING);
            at(PAUSE.finding, () => {
              setStep(STEP_CITATION);
              at(PAUSE.citation, () => {
                setStep(STEP_REDLINE);
                at(PAUSE.hold, () => {
                  setFadingOut(true);
                  at(PAUSE.fadeOut, cycle);
                });
              });
            });
          });
        }
      };
      at(400, typeNext);
    };
    cycle();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [animated, visible, clause]);

  const typed = animated ? clause.slice(0, typedCount) : clause;
  const showThinking = animated && step === STEP_THINKING;
  const showFinding = !animated || step >= STEP_FINDING;
  const showCitation = !animated || step >= STEP_CITATION;
  const showRedline = !animated || step >= STEP_REDLINE;

  return (
    <div className={styles.demoWindow} data-reveal ref={rootRef}>
      {/* The full example for screen readers — the animated copy is decorative. */}
      <p className="sr-only">
        {DEMO.clauseLabel[lang]}: {clause} — {DEMO.severity[lang]}: {DEMO.findingTitle[lang]}. {DEMO.findingText[lang]}{' '}
        ({DEMO.citation}). {DEMO.note[lang]}
      </p>

      <div className={styles.demoBar}>
        <span className={styles.demoDot} />
        <span className={styles.demoDot} />
        <span className={styles.demoDot} />
        <span className={styles.demoBarTitle}>{DEMO.windowTitle[lang]}</span>
      </div>

      <div className={`${styles.demoBody} ${fadingOut ? styles.demoBodyOut : ''}`} aria-hidden="true">
        <div className={styles.demoClause}>
          <div className={styles.demoClauseLabel}>{DEMO.clauseLabel[lang]}</div>
          <div className={styles.demoClauseText}>{typed}</div>
        </div>

        <div className={styles.demoSlot}>
          {showThinking ? (
            <div className={styles.demoThinking}>
              <LogoLoader size={24} />
              <span>{t('chat.thinking')}</span>
            </div>
          ) : null}

          {showFinding ? (
            <div className={`${styles.demoFinding} ${animated ? styles.demoStepIn : ''}`}>
              <div className={styles.demoFindingHead}>
                <span className={styles.demoSeverity}>
                  <Icon name="alert" size={13} />
                  {DEMO.severity[lang]}
                </span>
                {showCitation ? (
                  <span className={`${styles.demoCitation} ${animated ? styles.demoStepIn : ''}`}>
                    {DEMO.citation}
                    <span className={styles.demoVerified}>
                      <Icon name="check" size={12} />
                      {DEMO.verified[lang]}
                    </span>
                  </span>
                ) : null}
              </div>
              <div className={styles.demoFindingTitle}>{DEMO.findingTitle[lang]}</div>
              <div className={styles.demoFindingText}>{DEMO.findingText[lang]}</div>
              {showRedline ? (
                <div className={`${styles.demoRedline} ${animated ? styles.demoStepIn : ''}`}>
                  <div className={styles.demoRedlineLabel}>{DEMO.redlineLabel[lang]}</div>
                  <div className={styles.demoRedlineText}>
                    <del>{DEMO.redlineDel[lang]}</del> <ins>{DEMO.redlineIns[lang]}</ins>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const DEMO_NOTE: Text2 = DEMO.note;
