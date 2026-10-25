import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { savedDocsApi } from '@/api';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useDismissable } from '@/hooks/useAsync';
import { invalidateVaultCounts } from '@/hooks/useVaultCounts';
import { localeFor } from '@/i18n/dates';
import { useI18n } from '@/i18n/I18nProvider';
import { savedSourceId, type Artifact, type DeckArtifact, type DocArtifact, type TableArtifact } from '@/lib/artifacts';
import { deckFileName, type Deck } from '@/lib/deck';
import { downloadBlob } from '@/lib/download';
import { buildXlsx, colName, fileSafe, toCsv, toTsv } from '@/lib/xlsx';
import { useUIStore } from '@/store/useUIStore';
import type { SavedDoc } from '@/types/domain';
import styles from './chat.module.css';

/**
 * Боковая панель справа (как артефакты в Claude): документ — правится и
 * сохраняется в Vault → Documents, таблица — вид как в Excel, презентация —
 * просмотр слайдов. У каждого — «Скачать» в нужных для работы форматах.
 */

/** Правки документов за эту сессию: закрыл панель и открыл снова — текст на месте. */
const docEdits = new Map<string, string>();
/** Сохранённые документы — один запрос на сессию; сбрасывается после сохранения. */
let savedList: Promise<SavedDoc[]> | null = null;
const loadSaved = () => (savedList ??= savedDocsApi.list().catch((e) => ((savedList = null), Promise.reject(e))));

interface ExportItem {
  label: string;
  icon: IconName;
  run: () => Promise<void> | void;
}

function ExportMenu({ items }: { items: ExportItem[] }) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const ref = useDismissable<HTMLDivElement>(() => setOpen(false), open);
  return (
    <div className={styles.exportWrap} ref={ref}>
      <button
        type="button"
        className={styles.panelBtnPrimary}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="download" size={15} />
        <span>{t('artifact.download')}</span>
      </button>
      {open ? (
        <div className={styles.exportMenu} role="menu">
          {items.map((it, i) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={styles.exportItem}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(i);
                try {
                  await it.run();
                  setOpen(false);
                } catch {
                  pushToast(t('artifact.exportError'), 'error');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === i ? <Spinner size={14} /> : <Icon name={it.icon} size={15} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PanelHeader({
  icon,
  tone,
  title,
  sub,
  actions,
  onClose,
}: {
  icon: IconName;
  tone: string;
  title: string;
  sub?: string;
  actions: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.panelHead}>
      <div className={styles.slashIcon} data-tone={tone}>
        <Icon name={icon} size={15} strokeWidth={1.8} />
      </div>
      <div className={styles.panelTitleWrap}>
        <div className={styles.panelTitle} title={title}>
          {title}
        </div>
        {sub ? <div className={styles.panelSub}>{sub}</div> : null}
      </div>
      <div className={styles.panelActions}>{actions}</div>
      <button type="button" className={styles.panelClose} onClick={onClose} aria-label={t('artifact.close')} title={t('artifact.close')}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

const copyText = async (text: string) => {
  await navigator.clipboard.writeText(text);
};

// ── Документ ───────────────────────────────────────────────────────────────

function DocPane({ art, onClose }: { art: DocArtifact; onClose: () => void }) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [content, setContent] = useState(() => docEdits.get(art.key) ?? art.content);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const touched = useRef(docEdits.has(art.key));

  // Сохранённая версия (с любого устройства): ищем черновик, привязанный к
  // этому документу чата. Если пользователь уже правит — его текст не трогаем.
  useEffect(() => {
    let alive = true;
    loadSaved()
      .then((list) => {
        const s = list.find((x) => x.sourceTemplateId === savedSourceId(art.key));
        if (!alive || !s) return;
        setSavedId(s.id);
        setSavedContent(s.content);
        if (!touched.current) setContent(s.content);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [art.key]);

  const dirty = content !== (savedContent ?? art.content);
  const canSave = !saving && content.trim().length > 0 && (dirty || !savedId);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (savedId) {
        await savedDocsApi.update(savedId, { content });
      } else {
        const s = await savedDocsApi.save({ title: art.title, content, sourceTemplateId: savedSourceId(art.key) });
        setSavedId(s.id);
        invalidateVaultCounts();
      }
      setSavedContent(content);
      savedList = null;
      pushToast(t('artifact.savedToast'), 'success');
    } catch {
      pushToast(t('artifact.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const items: ExportItem[] = [
    { label: 'Word (.docx)', icon: 'doc', run: async () => downloadBlob(await savedDocsApi.exportDocx(art.title, content), fileSafe(art.title, 'docx')) },
    { label: 'PDF', icon: 'doc', run: async () => downloadBlob(await savedDocsApi.exportPdf(art.title, content), fileSafe(art.title, 'pdf')) },
    { label: t('artifact.formatTxt'), icon: 'doc', run: () => downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), fileSafe(art.title, 'txt')) },
    {
      label: t('artifact.copy'),
      icon: 'copy',
      run: async () => {
        await copyText(content);
        pushToast(t('artifact.copied'), 'success');
      },
    },
  ];

  return (
    <>
      <PanelHeader
        icon="doc"
        tone="analyze"
        title={art.title}
        sub={dirty && savedId ? t('artifact.unsaved') : t('artifact.editable')}
        onClose={onClose}
        actions={
          <>
            <button type="button" className={styles.panelBtn} onClick={() => void save()} disabled={!canSave}>
              {saving ? <Spinner size={14} /> : <Icon name="check" size={15} />}
              <span>{saving ? t('artifact.saving') : !dirty && savedId ? t('artifact.saved') : t('artifact.save')}</span>
            </button>
            <ExportMenu items={items} />
          </>
        }
      />
      <div className={styles.docScroll}>
        <textarea
          className={styles.docEditor}
          value={content}
          dir="auto"
          spellCheck
          aria-label={art.title}
          onChange={(e) => {
            touched.current = true;
            setContent(e.target.value);
            docEdits.set(art.key, e.target.value);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              void save();
            }
          }}
        />
      </div>
    </>
  );
}

// ── Таблица ────────────────────────────────────────────────────────────────

function TablePane({ art, onClose }: { art: TableArtifact; onClose: () => void }) {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const all = [art.header, ...art.rows];
  const data = { title: art.title, header: art.header, rows: art.rows };
  // Excel в RU/DE/KK/UZ ждёт «;» — иначе вся строка ляжет в одну ячейку.
  const delimiter = lang === 'en' || lang === 'ar' ? ',' : ';';

  const items: ExportItem[] = [
    { label: 'Excel (.xlsx)', icon: 'table', run: async () => downloadBlob(await buildXlsx(data), fileSafe(art.title, 'xlsx')) },
    { label: 'CSV', icon: 'table', run: () => downloadBlob(toCsv(data, delimiter), fileSafe(art.title, 'csv')) },
    {
      label: t('artifact.copyTable'),
      icon: 'copy',
      run: async () => {
        await copyText(toTsv(data));
        pushToast(t('artifact.copied'), 'success');
      },
    },
  ];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setSel((s) => ({
      r: Math.min(all.length - 1, Math.max(0, s.r + m[0])),
      c: Math.min(art.header.length - 1, Math.max(0, s.c + m[1])),
    }));
  };

  return (
    <>
      <PanelHeader
        icon="table"
        tone="plan"
        title={art.title}
        sub={t('artifact.size', { rows: art.rows.length, cols: art.header.length })}
        onClose={onClose}
        actions={<ExportMenu items={items} />}
      />
      <div className={styles.sheetBar}>
        <span className={styles.sheetRef}>{`${colName(sel.c)}${sel.r + 1}`}</span>
        <span className={styles.sheetFx}>fx</span>
        <span className={styles.sheetVal}>{all[sel.r]?.[sel.c] ?? ''}</span>
      </div>
      <div className={styles.sheetScroll} tabIndex={0} onKeyDown={onKeyDown}>
        <table className={styles.sheet}>
          <thead>
            <tr>
              <th className={styles.sheetCorner} />
              {art.header.map((_, c) => (
                <th key={c} className={`${styles.sheetColHead} ${sel.c === c ? styles.sheetHeadOn : ''}`}>
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((row, r) => (
              <tr key={r}>
                <th className={`${styles.sheetRowHead} ${sel.r === r ? styles.sheetHeadOn : ''}`}>{r + 1}</th>
                {art.header.map((_, c) => (
                  <td
                    key={c}
                    className={`${r === 0 ? styles.sheetHeaderCell : ''} ${sel.r === r && sel.c === c ? styles.sheetCellOn : ''}`}
                    onClick={() => setSel({ r, c })}
                  >
                    {row[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Презентация ────────────────────────────────────────────────────────────

function deckOutline(deck: Deck): string {
  return [
    deck.title,
    deck.subtitle ?? '',
    ...deck.slides.flatMap((s, i) => ['', `${i + 1}. ${s.title}`, ...s.bullets.map((b) => `- ${b}`)]),
  ]
    .filter((l, i) => l || i > 1)
    .join('\n');
}

/** Рамка 16:9 — «контейнер» для единиц cqw: всё внутри слайда (шрифты и
 *  отступы) масштабируется от его ширины — и на большом слайде, и в миниатюре. */
function SlideView(props: { deck: Deck; index: number; madeWith: string; date: string }) {
  return (
    <div className={styles.slideFrame}>
      <SlideContent {...props} />
    </div>
  );
}

function SlideContent({ deck, index, madeWith, date }: { deck: Deck; index: number; madeWith: string; date: string }) {
  if (index === 0) {
    return (
      <div className={`${styles.slideBox} ${styles.slideCover}`}>
        <span className={styles.slideBrand}>LEXAB</span>
        <span className={styles.slideCoverRule} />
        <span className={styles.slideCoverTitle}>{deck.title}</span>
        {deck.subtitle ? <span className={styles.slideCoverSub}>{deck.subtitle}</span> : null}
        <span className={styles.slideCoverFoot}>{`${madeWith} · ${date}`}</span>
      </div>
    );
  }
  const s = deck.slides[index - 1];
  return (
    <div className={styles.slideBox}>
      <span className={styles.slideTitle}>{s.title}</span>
      <span className={styles.slideRule} />
      <ul className={styles.slideList}>
        {s.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <span className={styles.slideFoot}>{`Lexab · ${deck.title}`}</span>
      <span className={styles.slideNum}>{`${index} / ${deck.slides.length}`}</span>
    </div>
  );
}

function DeckPane({ art, onClose }: { art: DeckArtifact; onClose: () => void }) {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [index, setIndex] = useState(0);
  const total = art.deck.slides.length + 1;
  const date = new Date().toLocaleDateString(localeFor(lang));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, [art.key]);

  const items: ExportItem[] = [
    {
      label: 'PowerPoint (.pptx)',
      icon: 'presentation',
      run: async () => {
        const { buildDeckPptx } = await import('@/lib/deckPptx');
        const blob = await buildDeckPptx(art.deck, { madeWith: t('deck.madeWith'), date, rtl: lang === 'ar' });
        downloadBlob(blob, deckFileName(art.deck));
      },
    },
    {
      label: t('artifact.copy'),
      icon: 'copy',
      run: async () => {
        await copyText(deckOutline(art.deck));
        pushToast(t('artifact.copied'), 'success');
      },
    },
  ];
  const notes = index > 0 ? art.deck.slides[index - 1].notes : undefined;
  const go = (d: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + d)));

  return (
    <>
      <PanelHeader
        icon="presentation"
        tone="slides"
        title={art.title}
        sub={t('deck.count', { n: total })}
        onClose={onClose}
        actions={<ExportMenu items={items} />}
      />
      <div
        ref={rootRef}
        className={styles.deckStage}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
        }}
      >
        <SlideView deck={art.deck} index={index} madeWith={t('deck.madeWith')} date={date} />
        <div className={styles.slideNav}>
          <button type="button" className={styles.slideNavBtn} onClick={() => go(-1)} disabled={index === 0} aria-label={t('artifact.prev')}>
            <Icon name="back" size={16} />
          </button>
          <span className={styles.slideCounter}>{t('artifact.slideOf', { n: index + 1, total })}</span>
          <button type="button" className={styles.slideNavBtn} onClick={() => go(1)} disabled={index === total - 1} aria-label={t('artifact.next')}>
            <Icon name="chevron" size={16} />
          </button>
        </div>
        {notes ? (
          <div className={styles.slideNotes}>
            <span className={styles.slideNotesLabel}>{t('artifact.notes')}</span>
            {notes}
          </div>
        ) : null}
        <div className={styles.slideStrip}>
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.slideThumbBtn} ${i === index ? styles.slideThumbOn : ''}`}
              onClick={() => setIndex(i)}
              aria-label={i === 0 ? t('artifact.cover') : art.deck.slides[i - 1].title}
            >
              <SlideView deck={art.deck} index={i} madeWith={t('deck.madeWith')} date={date} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function ArtifactPanel({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  // Esc закрывает панель (если фокус не в поле редактора документа).
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) onClose();
  };
  return (
    <aside className={styles.artifactPanel} onKeyDown={onKeyDown} aria-label={artifact.title}>
      {artifact.kind === 'doc' ? (
        <DocPane key={artifact.key} art={artifact} onClose={onClose} />
      ) : artifact.kind === 'table' ? (
        <TablePane key={artifact.key} art={artifact} onClose={onClose} />
      ) : (
        <DeckPane key={artifact.key} art={artifact} onClose={onClose} />
      )}
    </aside>
  );
}
