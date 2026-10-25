import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import type { ClarifyQuestion } from '@/lib/questions';
import styles from './chat.module.css';

/**
 * Карточки над полем ввода: уточняющие вопросы ИИ и одобрение плана.
 * Клавиатура: ↑/↓ — выбор строки, Enter — выбрать, E — свой ответ,
 * Esc — пропустить. Карточка забирает фокус, только если пользователь
 * в этот момент ничего не печатает.
 */

/** Фокус на карточку — если поле ввода пустое (пользователь не печатает). */
function useGrabFocus(ref: RefObject<HTMLDivElement>, deps: unknown[]) {
  useEffect(() => {
    const ae = document.activeElement;
    const idle = !ae || ae === document.body || (ae instanceof HTMLTextAreaElement && !ae.value.trim());
    if (idle) ref.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function Hints({ items }: { items: { keys: string[]; label: string }[] }) {
  return (
    <div className={styles.choiceHints} aria-hidden="true">
      {items.map((h) => (
        <span key={h.label}>
          {h.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
          {h.label}
        </span>
      ))}
    </div>
  );
}

function Shell({ children, hints }: { children: ReactNode; hints: ReactNode }) {
  return (
    <div className={styles.choiceWrap}>
      {children}
      {hints}
    </div>
  );
}

interface QuestionCardProps {
  questions: ClarifyQuestion[];
  /** Ответы (пропущенные вопросы не входят). Пустой список — всё пропущено. */
  onDone: (answered: { question: string; answer: string }[]) => void;
}

export function QuestionCard({ questions, onDone }: QuestionCardProps) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(0);
  const [active, setActive] = useState(0);
  const [custom, setCustom] = useState('');
  const [answered, setAnswered] = useState<{ question: string; answer: string }[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = questions[idx];
  const customRow = q.options.length; // последняя строка — «Свой вариант…»

  useGrabFocus(rootRef, [idx]);

  const next = (list: { question: string; answer: string }[]) => {
    if (idx + 1 < questions.length) {
      setAnswered(list);
      setIdx(idx + 1);
      setActive(0);
      setCustom('');
      rootRef.current?.focus({ preventScroll: true });
    } else {
      onDone(list);
    }
  };
  const choose = (answer: string) => next([...answered, { question: q.question, answer }]);
  const skip = () => next(answered);
  const move = (delta: number) => {
    const n = customRow + 1;
    const to = (active + delta + n) % n;
    setActive(to);
    if (to === customRow) inputRef.current?.focus();
    else rootRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const inInput = e.target === inputRef.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inInput) {
        if (custom.trim()) choose(custom.trim());
      } else if (active < customRow) choose(q.options[active]);
      else inputRef.current?.focus();
    } else if (!inInput && (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У')) {
      e.preventDefault();
      setActive(customRow);
      inputRef.current?.focus();
    }
  };

  return (
    <Shell
      hints={
        <Hints
          items={[
            { keys: ['↓', '↑'], label: t('clarify.hintNavigate') },
            { keys: ['E'], label: t('clarify.hintEdit') },
            { keys: ['Esc'], label: t('clarify.hintSkip') },
            { keys: ['↵'], label: t('clarify.hintChoose') },
          ]}
        />
      }
    >
      <div ref={rootRef} className={styles.choiceCard} tabIndex={-1} onKeyDown={onKeyDown} role="group" aria-label={q.question}>
        <div className={styles.choiceHead}>
          <span className={styles.choiceTitle}>{q.question}</span>
          {questions.length > 1 ? (
            <span className={styles.choiceCount}>{t('clarify.counter', { n: idx + 1, total: questions.length })}</span>
          ) : null}
          <button
            type="button"
            className={styles.choiceClose}
            aria-label={t('clarify.skipAll')}
            title={t('clarify.skipAll')}
            onClick={() => onDone(answered)}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className={styles.choiceList} role="listbox" aria-label={q.question}>
          {q.options.map((o, i) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={active === i}
              className={`${styles.choiceOption} ${active === i ? styles.choiceOptionActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <span className={styles.choiceOptionText}>{o}</span>
              {active === i ? (
                <span className={styles.choiceArrow}>
                  <Icon name="arrowRight" size={15} />
                </span>
              ) : null}
            </button>
          ))}
          <div className={`${styles.choiceOption} ${active === customRow ? styles.choiceOptionActive : ''}`}>
            <input
              ref={inputRef}
              className={styles.choiceInput}
              value={custom}
              placeholder={t('clarify.other')}
              aria-label={t('clarify.other')}
              onFocus={() => setActive(customRow)}
              onChange={(e) => setCustom(e.target.value)}
            />
            {custom.trim() ? (
              <span className={styles.choiceArrow}>
                <Icon name="arrowRight" size={15} />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}

interface PlanApprovalCardProps {
  onApprove: () => void;
  onChanges: (text: string) => void;
  onDismiss: () => void;
}

export function PlanApprovalCard({ onApprove, onChanges, onDismiss }: PlanApprovalCardProps) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const [text, setText] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useGrabFocus(rootRef, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const inInput = e.target === inputRef.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const to = active === 0 ? 1 : 0;
      setActive(to);
      if (to === 1) inputRef.current?.focus();
      else rootRef.current?.focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inInput) {
        if (text.trim()) onChanges(text.trim());
      } else if (active === 0) onApprove();
      else inputRef.current?.focus();
    }
  };

  return (
    <Shell
      hints={
        <Hints
          items={[
            { keys: ['↓', '↑'], label: t('clarify.hintNavigate') },
            { keys: ['↵'], label: t('clarify.hintChoose') },
          ]}
        />
      }
    >
      <div ref={rootRef} className={styles.choiceCard} tabIndex={-1} onKeyDown={onKeyDown} role="group" aria-label={t('plan.approve.title')}>
        <div className={styles.choiceHead}>
          <span className={styles.choiceTitle}>{t('plan.approve.title')}</span>
        </div>
        <div className={styles.choiceList}>
          <button
            type="button"
            className={`${styles.choiceOption} ${active === 0 ? styles.choiceOptionActive : ''}`}
            onMouseEnter={() => setActive(0)}
            onClick={onApprove}
          >
            <span className={styles.choiceIcon}>
              <Icon name="check" size={15} />
            </span>
            <span className={styles.choiceOptionText}>{t('plan.approve.ok')}</span>
            {active === 0 ? <span className={styles.choiceGo}>{t('plan.approve.choose')}</span> : null}
          </button>
          <div className={`${styles.choiceOption} ${active === 1 ? styles.choiceOptionActive : ''}`}>
            <span className={styles.choiceIcon}>
              <Icon name="pen" size={15} />
            </span>
            <input
              ref={inputRef}
              className={styles.choiceInput}
              value={text}
              placeholder={t('plan.approve.changes')}
              aria-label={t('plan.approve.changes')}
              onFocus={() => setActive(1)}
              onChange={(e) => setText(e.target.value)}
            />
            {text.trim() ? (
              <button type="button" className={styles.choiceGo} onClick={() => onChanges(text.trim())}>
                {t('plan.approve.choose')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** В ленте вместо сообщения «/approve …»: «✓ План одобрен», по клику — что отправлено. */
export function PlanApprovedPill({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.approvedPill}>
      <button type="button" className={styles.approvedHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={styles.approvedCheck}>
          <Icon name="check" size={16} strokeWidth={2.2} />
        </span>
        <span className={styles.approvedLabel}>{t('plan.approved')}</span>
        <span className={`${styles.approvedChevron} ${open ? styles.approvedChevronOpen : ''}`}>
          <Icon name="chevron" size={16} />
        </span>
      </button>
      {open && text ? <div className={styles.approvedBody}>{text}</div> : null}
    </div>
  );
}
