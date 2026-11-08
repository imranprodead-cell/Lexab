import { useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { LawTextBox } from '@/components/ui/VerifiedBadge';
import { useDismissable } from '@/hooks/useAsync';
import { useStreamingText } from '@/hooks/useStreamingText';
import { useI18n } from '@/i18n/I18nProvider';
import { analysisSources, citationKey, focusSource } from '@/lib/analysisSources';
import { EASE } from '@/lib/motion';
import { useChatStore } from '@/store/useChatStore';
import { isRedlineSlot, type AnalysisResult, type DocBlock, type Finding, type Redline, type Severity } from '@/types/domain';
import { RiskGauge } from './RiskGauge';
import styles from './chat.module.css';

/** Цвет пометки серьёзности — те же семантические токены, что и везде. */
const SEV_VAR: Record<Severity, string> = {
  High: 'var(--sev-high)',
  Medium: 'var(--sev-med)',
  Low: 'var(--sev-low)',
};
const sevStyle = (s: Severity) => ({ '--sev': SEV_VAR[s] }) as CSSProperties;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const blockText = (b: DocBlock) =>
  squash(b.text ?? (b.segments ?? []).map((s) => (typeof s === 'string' ? s : 'text' in s ? s.text : '')).join(''));

/** Заголовок пункта, в котором стоит правка («5. Расторжение»), — по id правки. */
function clausesOf(doc: DocBlock[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  let heading = '';
  for (const b of doc ?? []) {
    if (b.type === 'heading') {
      heading = blockText(b);
      continue;
    }
    for (const seg of b.segments ?? []) {
      if (isRedlineSlot(seg) && heading) out.set(seg.redlineId, heading.length > 60 ? `${heading.slice(0, 59)}…` : heading);
    }
  }
  return out;
}

/**
 * Правка под находкой: «было → стало» и решение прямо в чате. Принять или
 * отклонить — тот же setRedlineStatus, что и в рабочей области (с откатом при
 * ошибке сервера); «Открыть в договоре» ведёт к пункту в документе.
 */
function EditBox({ redline, canEdit, onOpen }: { redline: Redline; canEdit: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  const setStatus = useChatStore((s) => s.setRedlineStatus);
  const decided = redline.status !== 'pending';
  return (
    <div className={styles.memoDiff}>
      <div className={styles.memoDiffHead}>
        <span>{t('memo.edit')}</span>
      </div>
      <div className={styles.memoDiffText} dir="auto">
        {redline.delText.trim() ? <del className={styles.memoDel}>{redline.delText}</del> : null}
        {redline.insText.trim() ? (
          <ins className={styles.memoIns}>{redline.insText}</ins>
        ) : (
          <span className={styles.memoDiffNote}>{t('memo.deleted')}</span>
        )}
      </div>
      <div className={styles.memoDiffActions}>
        {decided ? (
          <span className={redline.status === 'accepted' ? styles.memoDone : styles.memoRejected}>
            <Icon name={redline.status === 'accepted' ? 'check' : 'x'} size={13} strokeWidth={2.2} />
            {t(redline.status === 'accepted' ? 'memo.accepted' : 'memo.rejected')}
          </span>
        ) : null}
        {!decided && canEdit ? (
          <Button variant="primary" size="sm" onClick={() => setStatus(redline.id, 'accepted')}>
            {t('memo.accept')}
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onOpen}>
          {t('memo.openInDoc')}
        </Button>
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => setStatus(redline.id, decided ? 'pending' : 'rejected')}>
            {t(decided ? 'memo.undo' : 'memo.reject')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface SummaryCardProps {
  analysis: AnalysisResult;
  onOpenWorkspace: () => void;
  /** Open the workspace and jump to the clause fixed by this finding's redline. */
  onOpenFinding: (redlineId: string) => void;
  /** Send one of the suggested document questions to the chat. */
  onAsk: (question: string) => void;
  /** "Other…": the user types their own question in the composer. */
  onAskCustom: () => void;
}

/**
 * Разбор договора в виде записки юриста (решение владельца 2026-10-31, вариант
 * «Меморандум»): вывод, оценка риска строкой, «Что исправить до подписания» с
 * правкой прямо в тексте и «Проверьте вручную» для неподтверждённых ссылок.
 * Законы — номерами у «Основания»; сам список норм в правой колонке Sources.
 * Без круговой шкалы и цветных плашек.
 */
export function SummaryCard({ analysis, onOpenWorkspace, onOpenFinding, onAsk, onAskCustom }: SummaryCardProps) {
  const { t } = useI18n();
  // onceKey = analysis id: the typewriter runs only the first time this
  // analysis is shown — reopening the chat renders the summary instantly.
  const { visible } = useStreamingText(analysis.summary, 2, 16, analysis.id);

  // "Ask a question" opens a picker with questions tailored to THIS document.
  const [askOpen, setAskOpen] = useState(false);
  const askRef = useDismissable<HTMLDivElement>(() => setAskOpen(false), askOpen);
  const questions = [
    ...analysis.findings.slice(0, 2).map((f) => t('chat.ask.explain', { title: f.title })),
    t('chat.ask.fix'),
    t('chat.ask.next'),
  ];

  const clauses = useMemo(() => clausesOf(analysis.document), [analysis.document]);
  const redlines = useMemo(() => new Map(analysis.redlines.map((r) => [r.id, r])), [analysis.redlines]);
  // Номера норм — те же, что в правой колонке Sources (общий список).
  const numberOf = useMemo(
    () => new Map(analysisSources(analysis.findings).map((src) => [src.key, src.n])),
    [analysis.findings],
  );
  // Неподтверждённая ссылка понижает находку (правило №4), но показываем её
  // отдельно — «Низкая» с галочкой у ничтожного пункта вводила в заблуждение.
  const main = analysis.findings.filter((f) => !f.unverified);
  const toCheck = analysis.findings.filter((f) => f.unverified);
  const canEdit = analysis.canEdit !== false;
  const count = (s: Severity) => main.filter((f) => f.severity === s).length;

  // Первая правка раскрыта сразу — видно «было → стало»; остальные по клику.
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const first = analysis.findings.find((f) => f.redlineId && redlines.has(f.redlineId));
    return new Set(first ? [first.id] : []);
  });
  const toggleEdit = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Номер нормы открывает её в правой колонке; если колонки на экране нет
  // (узкое окно, открыт документ) — текст нормы раскрывается под находкой.
  const [inlineLaw, setInlineLaw] = useState<Set<string>>(() => new Set());
  const onSource = (f: Finding, n: number) => {
    if (focusSource(n)) return;
    setInlineLaw((prev) => {
      const next = new Set(prev);
      if (next.has(f.id)) next.delete(f.id);
      else next.add(f.id);
      return next;
    });
  };

  const renderFinding = (f: Finding, num: number) => {
    const redline = f.redlineId ? redlines.get(f.redlineId) : undefined;
    const clause = f.redlineId ? clauses.get(f.redlineId) : undefined;
    const n = f.citation ? numberOf.get(citationKey(f.citation)) : undefined;
    const lawUnit = f.unitId && !f.unverified ? f.unitId : null;
    return (
      <li key={f.id} className={styles.memoItem}>
        <span className={styles.memoNum}>{num}.</span>
        <div className={styles.memoBody}>
          <div className={styles.memoTags}>
            {f.unverified ? (
              <span className={styles.memoSev}>
                <span className={`${styles.sevBox} ${styles.sevBoxGrey}`} aria-hidden="true" />
                {t('memo.checkLabel')}
              </span>
            ) : (
              <span className={styles.memoSev} style={sevStyle(f.severity)}>
                <span className={styles.sevBox} aria-hidden="true" />
                {t(`sev.${f.severity}`)}
              </span>
            )}
            {clause ? <span dir="auto">{clause}</span> : null}
            {f.playbookDeviation ? (
              <span className={styles.memoTag}>
                <Icon name="flag" size={12} />
                {t('playbooks.deviationBadge')}
              </span>
            ) : null}
          </div>
          <h4 className={styles.memoTitle} dir="auto">
            {f.title}
          </h4>
          {f.citation?.trim() ? (
            <div className={styles.memoCite}>
              <span dir="auto">
                {t('memo.basis')}: {f.citation}
              </span>
              {n ? (
                <button
                  type="button"
                  className={styles.memoChip}
                  onClick={() => onSource(f, n)}
                  aria-label={t('memo.toSource', { n })}
                  title={t('memo.toSource', { n })}
                >
                  {n}
                </button>
              ) : null}
            </div>
          ) : null}
          {lawUnit && inlineLaw.has(f.id) ? (
            <div className={styles.memoLaw}>
              <LawTextBox unitId={lawUnit} />
            </div>
          ) : null}
          {f.unverified ? <p className={styles.memoNote}>{t('memo.checkNote')}</p> : null}
          {redline ? (
            <>
              <button
                type="button"
                className={styles.memoLink}
                onClick={() => toggleEdit(f.id)}
                aria-expanded={openIds.has(f.id)}
              >
                {t(openIds.has(f.id) ? 'memo.hideEdit' : 'memo.showEdit')}
                <Icon
                  name="chevron"
                  size={12}
                  className={`${styles.memoLinkChevron} ${openIds.has(f.id) ? styles.memoLinkChevronOpen : ''}`}
                />
              </button>
              {/* Плавно раскрывается и сворачивается (reducedMotion="user" в AppShell
                  выключает анимацию тем, кто попросил систему её не показывать). */}
              <AnimatePresence initial={false}>
                {openIds.has(f.id) ? (
                  <motion.div
                    key="edit"
                    className={styles.memoReveal}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.32, ease: EASE }}
                  >
                    <EditBox redline={redline} canEdit={canEdit} onOpen={() => onOpenFinding(redline.id)} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <article className={styles.memo}>
      <p className={styles.memoLead} dir="auto">
        {visible}
      </p>

      {/* Скан или фото: текст для чата переписан ИИ со страниц — ошибка в цифре
          возможна, и человек должен знать это до того, как понесёт цитату. */}
      {analysis.scanOcr ? (
        <p className={styles.scanNote}>
          <Icon name="eye" size={14} />
          <span>{t(analysis.scanOcr === 'failed' ? 'chat.scanFailed' : 'chat.scanNote')}</span>
        </p>
      ) : null}

      {/* Шкала уже показывает «72 / 100» — рядом только уровень и счётчики. */}
      <div className={styles.memoRisk}>
        <RiskGauge score={analysis.riskScore} size="sm" />
        <div className={styles.memoRiskMain}>
          <span className={styles.memoRiskValue}>{t(`risk.${analysis.riskLevel}`)}</span>
          <span className={styles.memoCounts}>
            {(['High', 'Medium', 'Low'] as const).map((s) =>
              count(s) ? (
                <span key={s} className={styles.memoCount} style={sevStyle(s)}>
                  <span className={styles.sevBox} aria-hidden="true" />
                  {t(`sev.${s}`)} {count(s)}
                </span>
              ) : null,
            )}
            {toCheck.length ? (
              <span className={styles.memoCount}>
                <span className={`${styles.sevBox} ${styles.sevBoxGrey}`} aria-hidden="true" />
                {t('memo.checkLabel')} {toCheck.length}
              </span>
            ) : null}
          </span>
        </div>
      </div>

      {main.length ? (
        <section className={styles.memoSection}>
          <h3 className={styles.memoH}>{t('memo.fixTitle')}</h3>
          <ol className={styles.memoList}>{main.map((f, i) => renderFinding(f, i + 1))}</ol>
        </section>
      ) : analysis.findings.length === 0 ? (
        <p className={styles.memoNote}>{t('memo.noFindings')}</p>
      ) : null}

      {toCheck.length ? (
        <section className={styles.memoSection}>
          <h3 className={styles.memoH}>{t('memo.checkTitle')}</h3>
          <ol className={styles.memoList}>{toCheck.map((f, i) => renderFinding(f, main.length + i + 1))}</ol>
        </section>
      ) : null}

      <div className={styles.memoActions}>
        <Button variant="primary" icon="layout" onClick={onOpenWorkspace}>
          {t('memo.openDoc')}
        </Button>
        <div className={styles.askWrap} ref={askRef}>
          <Button variant="secondary" onClick={() => setAskOpen((v) => !v)}>
            {t('chat.sum.followUp')}
          </Button>
          {askOpen ? (
            <div className={styles.askMenu} role="menu">
              {questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="menuitem"
                  className={styles.askItem}
                  onClick={() => {
                    setAskOpen(false);
                    onAsk(q);
                  }}
                >
                  {q}
                </button>
              ))}
              <div className={styles.askDivider} />
              <button
                type="button"
                role="menuitem"
                className={`${styles.askItem} ${styles.askItemOther}`}
                onClick={() => {
                  setAskOpen(false);
                  onAskCustom();
                }}
              >
                <Icon name="pen" size={15} />
                {t('chat.ask.other')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
