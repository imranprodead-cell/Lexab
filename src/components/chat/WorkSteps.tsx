import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';
import { COUNTRIES, countryName } from '@/data/countries';
import { useI18n } from '@/i18n/I18nProvider';
import type { ChatStep, ChatWork } from '@/types/domain';
import { FileIcon } from './FileIcon';
import styles from './chat.module.css';

/** «UZ» базы законов → страна в списке выбора (у Британии там код GB). */
function lawCountry(code: string | undefined) {
  const c = code === 'UK' ? 'GB' : code;
  return COUNTRIES.find((x) => x.code === c);
}

/** Секунды работы: живой счётчик, пока идёт работа. */
function useElapsed(work: ChatWork | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!work) return 0;
  return Math.max(0, Math.round(((work.endedAt ?? now) - work.startedAt) / 1000));
}

/**
 * Ход работы над ответом вместо трёх точек — как у Claude и Harvey:
 * «Работаю…» и шаги по мере выполнения (прочитал файлы, искал в базе законов
 * по таким-то запросам, нашёл такие-то нормы, обдумываю ответ). Шаги приходят
 * с сервера и описывают только то, что он реально сделал. Когда пошёл текст
 * ответа, блок сворачивается в «Готово · 8 с» — его можно раскрыть.
 * Шаги агента (tool-N): поиск по базе, открытая статья, проверка ссылки,
 * перечитанный договор, расчёт — с тем, что именно сделано.
 */
export function WorkSteps({ work, working }: { work?: ChatWork; working: boolean }) {
  const { t, lang } = useI18n();
  // null — пользователь не трогал: раскрыто, пока идёт работа, потом свёрнуто.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? working;
  const seconds = useElapsed(work, working);
  // «Обдумываю ответ» — всегда последним: шаги агента (tool-N) приходят после него.
  const all = work?.steps ?? [];
  const steps = [...all.filter((s) => s.id !== 'answer'), ...all.filter((s) => s.id === 'answer')];

  const searchTitle = (jurisdiction: string | undefined): ReactNode => {
    const c = lawCountry(jurisdiction);
    return (
      <>
        {t('work.searchBefore')}{' '}
        <span className={styles.workChipStrong}>
          <Icon name="folder" size={13} />
          {t('work.lawBase', { country: c ? countryName(c, lang) : (jurisdiction ?? '') })}
        </span>{' '}
        {t('work.searchAfter')}
      </>
    );
  };

  const title = (step: ChatStep): ReactNode => {
    const d = step.data ?? {};
    if (step.id.startsWith('tool-')) {
      if (d.tool === 'search_law') return searchTitle(d.jurisdiction);
      if (d.tool === 'get_provision') return t('work.tool.getProvision');
      if (d.tool === 'verify_citation') return t('work.tool.verifyCitation');
      if (d.tool === 'read_contract') return t('work.tool.readContract');
      if (d.tool === 'search_documents') return t('work.tool.searchDocuments');
      if (d.tool === 'propose_edit') return t('work.tool.proposeEdit');
      if (d.tool === 'get_review_edits') return t('work.tool.reviewEdits');
      if (d.tool === 'propose_reminder') return t('work.tool.reminder');
      if (d.tool === 'get_playbook') return t('work.tool.playbook');
      if (d.tool === 'compare_versions') return t('work.tool.compare');
      if (d.tool === 'calculate') return t('work.tool.calculate');
      return null;
    }
    switch (step.id) {
      case 'prompt':
        return t('work.prompt');
      case 'contract':
        return t('work.contract');
      case 'files':
        return t('work.files');
      case 'memory':
        return t('work.memory');
      case 'mode':
        return t(`work.mode.${d.mode === 'slides' || d.mode === 'approve' ? d.mode : 'plan'}`);
      case 'answer':
        return working ? `${t('work.thinking')} · ${t('work.seconds', { n: seconds })}` : t('work.thinking');
      case 'search':
        return searchTitle(d.jurisdiction);
      default:
        return null;
    }
  };

  const chips = (items: string[], icon: 'search' | 'doc') => (
    <div className={styles.workChips}>
      {items.map((q) => (
        <span key={q} className={styles.workChip} title={q}>
          <Icon name={icon} size={12} />
          <span className={styles.workChipText}>{q}</span>
        </span>
      ))}
    </div>
  );

  const toolDetails = (step: ChatStep): ReactNode => {
    const d = step.data ?? {};
    if (d.tool === 'get_provision') {
      const shown = d.refs?.length ? d.refs.map((r) => (r.doc ? `${r.label} · ${r.doc}` : r.label)) : d.citation ? [d.citation] : [];
      return (
        <>
          {shown.length ? chips(shown, 'doc') : null}
          {step.status === 'done' && d.found === 0 ? <div className={styles.workDesc}>{t('work.verdict.not_found')}</div> : null}
        </>
      );
    }
    if (d.tool === 'verify_citation') {
      return (
        <>
          {d.citation ? chips([d.citation], 'doc') : null}
          {step.status === 'done' && d.verdict ? <div className={styles.workDesc}>{t(`work.verdict.${d.verdict}`)}</div> : null}
        </>
      );
    }
    if (d.tool === 'read_contract') {
      return (
        <>
          {d.files?.length ? (
            <div className={styles.workChips}>
              {d.files.map((f) => (
                <span key={f} className={styles.workChip}>
                  <FileIcon name={f} size={16} />
                  <span className={styles.workChipText}>{f}</span>
                </span>
              ))}
            </div>
          ) : null}
          {d.queries?.length ? chips(d.queries, 'search') : null}
        </>
      );
    }
    if (d.tool === 'search_documents') {
      return (
        <>
          {d.queries?.length ? chips(d.queries, 'search') : null}
          {step.status === 'done' && d.found !== undefined ? (
            <div className={styles.workDesc}>{d.found ? t('work.docsFound', { n: d.found }) : t('work.docsNone')}</div>
          ) : null}
          {d.files?.length ? (
            <div className={styles.workChips}>
              {d.files.map((f) => (
                <span key={f} className={styles.workChip}>
                  <FileIcon name={f} size={16} />
                  <span className={styles.workChipText}>{f}</span>
                </span>
              ))}
            </div>
          ) : null}
        </>
      );
    }
    if (d.tool === 'propose_edit' && d.citation) return chips([d.citation], 'doc');
    if (d.tool === 'propose_reminder' && d.citation) return chips([d.citation], 'doc');
    if (d.tool === 'get_playbook' && step.status === 'done' && d.found !== undefined) {
      return <div className={styles.workDesc}>{d.found ? t('work.playbookFound') : t('work.playbookNone')}</div>;
    }
    if (d.tool === 'compare_versions') {
      return (
        <>
          {d.files?.length ? (
            <div className={styles.workChips}>
              {d.files.map((f) => (
                <span key={f} className={styles.workChip}>
                  <FileIcon name={f} size={16} />
                  <span className={styles.workChipText}>{f}</span>
                </span>
              ))}
            </div>
          ) : null}
          {step.status === 'done' && d.found !== undefined ? (
            <div className={styles.workDesc}>{d.found ? t('work.diffFound', { n: d.found }) : t('work.diffNone')}</div>
          ) : null}
        </>
      );
    }
    if (d.tool === 'calculate' && d.expression) {
      return <div className={styles.workDesc}>{d.result ? `${d.expression} = ${d.result}` : d.expression}</div>;
    }
    return null;
  };

  const details = (step: ChatStep): ReactNode => {
    const d = step.data ?? {};
    if (step.id.startsWith('tool-') && d.tool !== 'search_law') return toolDetails(step);
    if (step.id === 'contract' && d.name) {
      return (
        <div className={styles.workChips}>
          <span className={styles.workChip}>
            <FileIcon name={d.name} size={16} />
            <span className={styles.workChipText}>{d.name}</span>
          </span>
        </div>
      );
    }
    if (step.id === 'files' && d.files?.length) {
      return (
        <div className={styles.workChips}>
          {d.files.map((f) => (
            <span key={f} className={styles.workChip}>
              <FileIcon name={f} size={16} />
              <span className={styles.workChipText}>{f}</span>
            </span>
          ))}
        </div>
      );
    }
    if (step.id === 'search' || d.tool === 'search_law') {
      const result =
        step.status !== 'done'
          ? null
          : d.failed
            ? t('work.searchFailed')
            : d.found
              ? t('work.found', { n: d.found })
              : t('work.foundNone');
      return (
        <>
          {d.queries?.length ? (
            <div className={styles.workChips}>
              {d.queries.map((q) => (
                <span key={q} className={styles.workChip}>
                  <Icon name="search" size={12} />
                  <span className={styles.workChipText}>{q}</span>
                </span>
              ))}
            </div>
          ) : null}
          {result ? <div className={styles.workDesc}>{result}</div> : null}
          {d.refs?.length ? (
            <div className={styles.workChips}>
              {d.refs.map((r) => (
                <span key={`${r.label}-${r.doc}`} className={styles.workChip} title={r.doc ? `${r.label} · ${r.doc}` : r.label}>
                  <Icon name="doc" size={12} />
                  <span className={styles.workChipText}>{r.doc ? `${r.label} · ${r.doc}` : r.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </>
      );
    }
    return null;
  };

  return (
    <div className={styles.work} data-working={working ? 'true' : undefined}>
      <button
        type="button"
        className={styles.workHead}
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        aria-label={t('work.toggle')}
      >
        <span className={working ? styles.workShimmer : undefined} role={working ? 'status' : undefined}>
          {working ? t('work.working') : `${t('work.done')} · ${t('work.seconds', { n: seconds })}`}
        </span>
        <span className={styles.workChevron} data-open={open ? 'true' : undefined}>
          <Icon name="chevron" size={14} strokeWidth={2} />
        </span>
      </button>

      {open && steps.length ? (
        <ol className={styles.workList}>
          {steps.map((step) => {
            const active = working && step.status === 'active';
            return (
              <li key={step.id} className={styles.workStep} data-active={active ? 'true' : undefined}>
                <span className={styles.workMarker} aria-hidden="true">
                  {step.id === 'search' || step.data?.tool === 'search_law' ? (
                    <Icon name="search" size={14} strokeWidth={2} />
                  ) : step.data?.tool === 'search_documents' ? (
                    <Icon name="folder" size={14} strokeWidth={2} />
                  ) : step.data?.tool === 'get_provision' || step.data?.tool === 'verify_citation' ? (
                    <Icon name="doc" size={14} strokeWidth={2} />
                  ) : (
                    <span className={styles.workDot} />
                  )}
                </span>
                <div className={`${styles.workTitle} ${active ? styles.workShimmer : ''}`}>{title(step)}</div>
                {details(step)}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
