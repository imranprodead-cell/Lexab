import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { chatsApi } from '@/api/chats.api';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import { extractArtifacts, type Artifact } from '@/lib/artifacts';
import { isSlidesCommand, parseDeck } from '@/lib/deck';
import { approvedPlan } from '@/lib/planSteps';
import { extractQuestions } from '@/lib/questions';
import { useUIStore } from '@/store/useUIStore';
import type { ChatMessage, ChatStep, PlanProgress } from '@/types/domain';
import { FileIcon } from './FileIcon';
import styles from './chat.module.css';

interface TaskSidebarProps {
  messages: ChatMessage[];
  /** Чат на сервере (в тестовом режиме — 'local'); null — чата ещё нет. */
  sessionKey: string | null;
  onOpenArtifact: (a: Artifact) => void;
}

/** Значок файла для результата ИИ: документ — Word, таблица — Excel, колода — PowerPoint. */
const OUTPUT_ICON: Record<Artifact['kind'], string> = { doc: 'x.docx', table: 'x.xlsx', deck: 'x.pptx' };

type Mark = 'done' | 'active' | 'todo';

/** «lex.uz», «legislation.gov.uk» — сайт, где откроется статья. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function StepMark({ mark }: { mark: Mark }) {
  if (mark === 'done') {
    return (
      <span className={styles.sideMarkDone} aria-hidden="true">
        <Icon name="check" size={11} strokeWidth={3} />
      </span>
    );
  }
  return <span className={mark === 'active' ? styles.sideMarkActive : styles.sideMarkTodo} aria-hidden="true" />;
}

/** Сворачиваемый раздел колонки: заголовок со стрелкой, как у Harvey. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  return (
    <section className={styles.sideSection}>
      <button
        type="button"
        className={styles.sideHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('side.toggle', { name: title })}
      >
        <span>{title}</span>
        <span className={styles.sideChevron} data-open={open ? 'true' : undefined}>
          <Icon name="chevron" size={14} strokeWidth={2} />
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}

/**
 * Правая колонка чата: Progress и Context (Outputs / Sources), как у Harvey.
 *
 * Progress — шаги одобренного плана (/plan → «Одобрить»): юрист отмечает
 * выполненные, отметки хранятся в чате на сервере; и шаги последнего ответа
 * ИИ — настоящие, с сервера (прочитал файлы, искал в базе законов…).
 * Outputs — документы, таблицы и презентации из ответов ИИ (открываются в
 * боковой панели). Sources — файлы чата, разобранный договор и статьи
 * законов, найденные в базе для ответов.
 */
export function TaskSidebar({ messages, sessionKey, onOpenArtifact }: TaskSidebarProps) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [tab, setTab] = useState<'outputs' | 'sources'>('outputs');

  // ── Progress ────────────────────────────────────────────────────────────
  const plan = useMemo(() => approvedPlan(messages), [messages]);
  const [progress, setProgress] = useState<PlanProgress | null>(null);
  useEffect(() => {
    setProgress(null);
    if (!sessionKey) return;
    const controller = new AbortController();
    chatsApi
      .getProgress(sessionKey, controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) setProgress(p);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [sessionKey]);
  const done = new Set(plan && progress?.messageId === plan.messageId ? progress.done : []);

  const toggleStep = (index: number) => {
    if (!plan || !sessionKey) return;
    const next = new Set(done);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    const prev = progress;
    const updated: PlanProgress = { messageId: plan.messageId, done: [...next].sort((a, b) => a - b) };
    setProgress(updated);
    chatsApi.saveProgress(sessionKey, updated).catch(() => {
      setProgress(prev);
      pushToast(t('side.saveError'), 'error');
    });
  };

  const lastWork = [...messages].reverse().find((m) => m.role === 'assistant' && m.work?.steps.length);
  const working = Boolean(lastWork?.streaming && !lastWork.work?.endedAt);
  const stepTitle = (s: ChatStep): string => {
    switch (s.id) {
      case 'prompt':
        return t('work.prompt');
      case 'contract':
        return t('work.contract');
      case 'files':
        return t('work.files');
      case 'memory':
        return t('work.memory');
      case 'search':
        return t('side.searchLaw');
      case 'mode':
        return t(`work.mode.${s.data?.mode === 'slides' || s.data?.mode === 'approve' ? s.data.mode : 'plan'}`);
      default:
        return t('work.thinking');
    }
  };

  // ── Outputs ─────────────────────────────────────────────────────────────
  const outputs = useMemo(() => {
    const out: Artifact[] = [];
    messages.forEach((m, i) => {
      if (m.role !== 'assistant' || m.streaming || !m.text) return;
      const prev = messages[i - 1];
      const deck = prev?.role === 'user' && isSlidesCommand(prev.text) ? parseDeck(m.text) : null;
      if (deck) {
        out.push({ kind: 'deck', key: `${m.id}:deck`, title: deck.title, deck });
        return;
      }
      out.push(
        ...extractArtifacts(extractQuestions(m.text).body, m.id, {
          document: t('artifact.document'),
          table: t('artifact.table'),
        }),
      );
    });
    return out;
  }, [messages, t]);

  // ── Sources ─────────────────────────────────────────────────────────────
  const sources = useMemo(() => {
    const files = new Map<string, { name: string; sub: string }>();
    const laws = new Map<string, { label: string; doc: string; url?: string }>();
    for (const m of messages) {
      if (m.role === 'user' && m.kind === 'file' && m.file) files.set(m.file.name, { name: m.file.name, sub: t('side.reviewed') });
      for (const a of m.attachments ?? []) if (!files.has(a.name)) files.set(a.name, { name: a.name, sub: t('side.attached') });
      const live = m.work?.steps.find((s) => s.id === 'search')?.data?.refs ?? [];
      for (const r of [...(m.refs ?? []), ...live]) {
        const key = `${r.label}|${r.doc}`;
        // Та же статья из разных ответов — одна строка; ссылку берём, где она есть.
        if (!laws.has(key) || (!laws.get(key)?.url && r.url)) laws.set(key, r);
      }
    }
    return { files: [...files.values()], laws: [...laws.values()] };
  }, [messages, t]);

  const hasProgress = Boolean(plan) || Boolean(lastWork);

  return (
    <aside className={styles.side} aria-label={`${t('side.progress')} · ${t('side.context')}`}>
      <Section title={t('side.progress')}>
        {hasProgress ? (
          <div className={styles.sideBody}>
            {plan ? (
              <div className={styles.sideGroup}>
                <div className={styles.sideGroupLabel}>
                  {t('side.planGroup')} · {t('side.planCount', { done: done.size, total: plan.steps.length })}
                </div>
                <ul className={styles.sideSteps}>
                  {plan.steps.map((step, i) => {
                    const isDone = done.has(i);
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          className={styles.sideStepBtn}
                          data-done={isDone ? 'true' : undefined}
                          onClick={() => toggleStep(i)}
                          aria-pressed={isDone}
                          aria-label={t(isDone ? 'side.markUndone' : 'side.markDone', { step })}
                        >
                          <StepMark mark={isDone ? 'done' : 'todo'} />
                          <span className={styles.sideStepText}>{step}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {lastWork?.work ? (
              <div className={styles.sideGroup}>
                <div className={styles.sideGroupLabel}>{t('side.answerGroup')}</div>
                <ul className={styles.sideSteps}>
                  {lastWork.work.steps.map((s) => {
                    const mark: Mark = working && s.status === 'active' ? 'active' : 'done';
                    return (
                      <li key={s.id} className={styles.sideStep} data-done={mark === 'done' ? 'true' : undefined}>
                        <StepMark mark={mark} />
                        <span className={styles.sideStepText}>{stepTitle(s)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.sideEmpty}>
            <span className={styles.sideEmptyIcon}>
              <Icon name="listChecks" size={20} />
            </span>
            <p>{t('side.progressEmpty')}</p>
          </div>
        )}
      </Section>

      <Section title={t('side.context')}>
        <div className={styles.sideBody}>
          <div className={styles.sideTabs} role="tablist">
            {(['outputs', 'sources'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={styles.sideTab}
                data-on={tab === k ? 'true' : undefined}
                onClick={() => setTab(k)}
              >
                {t(`side.${k}`)}
              </button>
            ))}
          </div>

          {tab === 'outputs' ? (
            outputs.length ? (
              <ul className={styles.sideList}>
                {outputs.map((a) => (
                  <li key={a.key}>
                    <button type="button" className={styles.sideItem} onClick={() => onOpenArtifact(a)} title={a.title}>
                      <FileIcon name={OUTPUT_ICON[a.kind]} size={20} />
                      <span className={styles.sideItemText}>
                        <span className={styles.sideItemName}>{a.title}</span>
                        <span className={styles.sideItemSub}>
                          {t('side.generated')} · {t(`side.kind.${a.kind}`)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.sideNote}>{t('side.outputsEmpty')}</p>
            )
          ) : sources.files.length || sources.laws.length ? (
            <ul className={styles.sideList}>
              {sources.files.map((f) => (
                <li key={`f:${f.name}`} className={styles.sideItem} data-static="true" title={f.name}>
                  <FileIcon name={f.name} size={20} />
                  <span className={styles.sideItemText}>
                    <span className={styles.sideItemName}>{f.name}</span>
                    <span className={styles.sideItemSub}>{f.sub}</span>
                  </span>
                </li>
              ))}
              {sources.laws.map((r) => {
                const body = (
                  <>
                    <span className={styles.sideLawIcon} aria-hidden="true">
                      <Icon name="doc" size={14} />
                    </span>
                    <span className={styles.sideItemText}>
                      <span className={styles.sideItemName}>{r.label}</span>
                      {r.doc ? <span className={styles.sideItemSub}>{r.doc}</span> : null}
                      {r.url ? <span className={styles.sideItemHost}>{hostOf(r.url)}</span> : null}
                    </span>
                  </>
                );
                return (
                  <li key={`l:${r.label}|${r.doc}`}>
                    {/* Статья на официальном сайте (lex.uz, legislation.gov.uk…) —
                        сразу на нужном месте, в новой вкладке. */}
                    {r.url ? (
                      <a
                        className={styles.sideItem}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('side.openOfficial', { site: hostOf(r.url) })}
                      >
                        {body}
                        <span className={styles.sideItemOut} aria-hidden="true">
                          <Icon name="arrowUpRight" size={14} />
                        </span>
                      </a>
                    ) : (
                      <div className={styles.sideItem} data-static="true" title={r.doc ? `${r.label} · ${r.doc}` : r.label}>
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.sideNote}>{t('side.sourcesEmpty')}</p>
          )}
        </div>
      </Section>
    </aside>
  );
}
