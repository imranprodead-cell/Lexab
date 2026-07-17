import { useMemo, useState, type FormEvent } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync, useDismissable } from '@/hooks/useAsync';
import { templatesApi } from '@/api';
import { COUNTRIES, flagUrl } from '@/data/countries';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import type { SavedTemplate, Template } from '@/types/domain';
import styles from './pages.module.css';

/** Jurisdictions offered in the generator — real flag images, full aspect. */
const JURISDICTIONS = ['US', 'GB', 'DE', 'CA', 'KZ', 'UZ', 'AE']
  .map((code) => COUNTRIES.find((c) => c.code === code))
  .filter((c): c is (typeof COUNTRIES)[number] => Boolean(c));

const JURISDICTION_EN: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  CA: 'Canada',
  KZ: 'Kazakhstan',
  UZ: 'Uzbekistan',
  AE: 'UAE',
};

/** Map a template's free-text jurisdiction to one of the picker countries. */
function matchJurisdiction(text: string): string {
  const s = text.toLowerCase();
  if (/kingdom|brit|england|\buk\b/.test(s)) return 'GB';
  if (/united states|\bus\b|usa|delaware/.test(s)) return 'US';
  if (/german|deutsch/.test(s)) return 'DE';
  if (/canad/.test(s)) return 'CA';
  if (/kazakh|казах/.test(s)) return 'KZ';
  if (/uzbek|узбек/.test(s)) return 'UZ';
  if (/uae|emirat|эмират|оаэ/.test(s)) return 'AE';
  return 'GB';
}

const PICKER_CODES = new Set(JURISDICTIONS.map((c) => c.code));

/** Russian category labels (categories are stored as English values, localized
 *  client-side for ru/kk/uz; other languages keep the English value). */
const CATEGORY_RU: Record<string, string> = {
  Confidentiality: 'Конфиденциальность',
  Employment: 'Трудовые',
  Commercial: 'Коммерческие',
  Privacy: 'Приватность',
  Fundraising: 'Инвестиции',
  'Real Estate': 'Недвижимость',
  Sales: 'Купля-продажа',
  Finance: 'Финансы',
  'IP & IT': 'IP и IT',
  Corporate: 'Корпоративные',
};

/** Reusable clause/document library + AI contract generator. */
export function TemplatesPage() {
  const { t, lang } = useI18n();
  usePageTitle(t('tpl.title'));
  const pushToast = useUIStore((s) => s.pushToast);
  const uiCountry = useUIStore((s) => s.country);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');

  // ru/kk/uz users see the Russian catalog labels; the English fields still
  // drive the generator prompt.
  const ru = lang === 'ru' || lang === 'kk' || lang === 'uz';
  const localName = (tpl: Template) => (ru && tpl.nameRu ? tpl.nameRu : tpl.name);
  const localDesc = (tpl: Template) => (ru && tpl.descriptionRu ? tpl.descriptionRu : tpl.description);
  const localCategory = (c: string) => (ru ? (CATEGORY_RU[c] ?? c) : c);

  // The category filter is derived from the templates the SERVER returns —
  // the full list is fetched once and filtered client-side.
  const { data, loading, error, reload } = useAsync((signal) => templatesApi.list('All', signal), []);
  const allRows = useMemo(() => data ?? [], [data]);
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(allRows.map((tpl) => tpl.category)))],
    [allRows],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(
      (tpl) =>
        (category === 'All' || tpl.category === category) &&
        (!q || `${tpl.name} ${tpl.nameRu ?? ''}`.toLowerCase().includes(q)),
    );
  }, [allRows, category, search]);

  // Generator modal state.
  const [tpl, setTpl] = useState<Template | null>(null);
  const [partyA, setPartyA] = useState('');
  const [partyB, setPartyB] = useState('');
  const [jurisdiction, setJurisdiction] = useState('GB'); // country code
  const [jurisOpen, setJurisOpen] = useState(false);
  const jurisRef = useDismissable<HTMLDivElement>(() => setJurisOpen(false), jurisOpen);
  const [term, setTerm] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Personal saved-template library (per user).
  const { data: savedData, reload: reloadSaved } = useAsync((signal) => templatesApi.listSaved(signal), []);
  const saved = useMemo(() => savedData ?? [], [savedData]);
  const [viewSaved, setViewSaved] = useState<SavedTemplate | null>(null);

  const countryName = (code: string) =>
    lang === 'ru'
      ? (JURISDICTIONS.find((c) => c.code === code)?.name ?? code)
      : (JURISDICTION_EN[code] ?? code);
  const selectedJuris = JURISDICTIONS.find((c) => c.code === jurisdiction) ?? JURISDICTIONS[0];

  const openGenerator = (template: Template) => {
    setTpl(template);
    // Default to the app's selected country when it's an offered jurisdiction,
    // otherwise fall back to the template's own jurisdiction.
    setJurisdiction(PICKER_CODES.has(uiCountry) ? uiCountry : matchJurisdiction(template.jurisdiction));
    setJurisOpen(false);
    setDraft(null);
  };

  const close = () => {
    setTpl(null);
    setDraft(null);
    setPartyA('');
    setPartyB('');
    setTerm('');
    setDetails('');
    setJurisOpen(false);
  };

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    if (!tpl || !partyA.trim() || !partyB.trim()) return;
    setBusy(true);
    try {
      setDraft(
        await templatesApi.generate(tpl.id, {
          partyA: partyA.trim(),
          partyB: partyB.trim(),
          // Send a readable jurisdiction ("US law", "German law", …) to the AI.
          jurisdiction: selectedJuris.law,
          term,
          details,
        }),
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const downloadContent = (title: string, content: string) => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><pre style="font-family:Georgia,serif;font-size:12pt;white-space:pre-wrap;">${content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre></body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\wа-яА-ЯёЁ -]+/g, '').slice(0, 80) || 'contract'}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyContent = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      pushToast(t('tpl.copied'), 'success');
    } catch {
      pushToast(t('common.error'), 'error');
    }
  };

  /** Keep the current generated draft in the personal library. */
  const saveDraftAsTemplate = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await templatesApi.saveDraft({
        title: draft.title,
        content: draft.content,
        sourceTemplateId: tpl?.id,
        jurisdiction: selectedJuris.law,
      });
      pushToast(t('tpl.savedToast'), 'success');
      reloadSaved();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeSaved = async (id: string) => {
    try {
      await templatesApi.removeSaved(id);
      pushToast(t('tpl.deletedToast'), 'default');
      if (viewSaved?.id === id) setViewSaved(null);
      reloadSaved();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  return (
    <div className={styles.page}>
      <TopBar title={t('tpl.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('tpl.title')}</h1>
            <p className={styles.pageSub}>{t('tpl.sub')}</p>
          </div>

          {saved.length > 0 ? (
            <div style={{ marginBottom: 28 }}>
              <h2 className={styles.sectionTitle}>{t('tpl.mySaved')}</h2>
              <div className={styles.grid}>
                {saved.map((s) => (
                  <div
                    key={s.id}
                    className={`${styles.card} ${styles.savedCard}`}
                    onClick={() => setViewSaved(s)}
                  >
                    <button
                      type="button"
                      className={styles.savedDelete}
                      aria-label={t('tpl.delete')}
                      title={t('tpl.delete')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeSaved(s.id);
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                    <div className={styles.cardIcon}>
                      <Icon name="docs" size={20} />
                    </div>
                    <div className={styles.cardTitle}>{s.title}</div>
                    {s.jurisdiction ? <div className={styles.savedMeta}>{s.jurisdiction}</div> : null}
                    <div className={styles.cardCta}>
                      <Icon name="eye" size={14} />
                      {t('tpl.view')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.toolbar}>
            <SelectMenu
              ariaLabel="category"
              value={category}
              options={categories.map((c) => ({ value: c, label: c === 'All' ? t('tpl.allCategories') : localCategory(c) }))}
              onChange={setCategory}
            />
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}>
                <Icon name="search" size={16} />
              </span>
              <input
                className={styles.searchInput}
                placeholder={t('tpl.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('tpl.search')}
              />
            </div>
          </div>

          {loading ? (
            <SkeletonRows rows={4} height={110} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <EmptyState icon="layout" title={t('tpl.empty')} />
          ) : (
            <div className={styles.grid}>
              {rows.map((template) => (
                <div key={template.id} className={styles.card} onClick={() => openGenerator(template)}>
                  <div className={styles.cardIcon}>
                    <Icon name="layout" size={20} />
                  </div>
                  <div className={styles.cardTitle}>{localName(template)}</div>
                  <div className={styles.cardDesc}>{localDesc(template)}</div>
                  <div className={styles.cardFoot}>
                    <span>{localCategory(template.category)}</span>
                    <span>
                      {template.jurisdiction} · {template.clauses} {t('tpl.clauses')}
                    </span>
                  </div>
                  <div className={styles.cardCta}>
                    <Icon name="sparkle" size={14} />
                    {t('tpl.generate')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {tpl ? (
        <div className={styles.modalOverlay} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <GlassCard className={styles.modalCard} style={{ maxWidth: draft ? 680 : 460 }}>
            {!draft ? (
              <>
                <h2 className={styles.modalTitle}>
                  {t('tpl.genTitle')} · {localName(tpl)}
                </h2>
                <form onSubmit={generate} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className={styles.formRow}>
                    <TextField label={t('tpl.partyA')} name="partyA" value={partyA} onChange={(e) => setPartyA(e.target.value)} />
                    <TextField label={t('tpl.partyB')} name="partyB" value={partyB} onChange={(e) => setPartyB(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.jurisField}>
                      <span className={styles.jurisLabel}>{t('tpl.jurisdiction')}</span>
                      <div className={styles.jurisWrap} ref={jurisRef}>
                        <button
                          type="button"
                          className={styles.jurisSelect}
                          aria-haspopup="listbox"
                          aria-expanded={jurisOpen}
                          onClick={() => setJurisOpen((v) => !v)}
                        >
                          <img className={styles.jurisFlag} src={flagUrl(selectedJuris.code)} alt="" />
                          <span className={styles.jurisName}>{countryName(selectedJuris.code)}</span>
                          <span className={`${styles.jurisChevron} ${jurisOpen ? styles.jurisChevronOpen : ''}`}>
                            <Icon name="chevron" size={14} />
                          </span>
                        </button>
                        {jurisOpen ? (
                          <div className={styles.jurisMenu} role="listbox">
                            {JURISDICTIONS.map((c) => (
                              <button
                                key={c.code}
                                type="button"
                                role="option"
                                aria-selected={c.code === jurisdiction}
                                className={`${styles.jurisOption} ${c.code === jurisdiction ? styles.jurisOptionActive : ''}`}
                                onClick={() => {
                                  setJurisdiction(c.code);
                                  setJurisOpen(false);
                                }}
                              >
                                <img className={styles.jurisFlag} src={flagUrl(c.code)} alt="" />
                                <span className={styles.jurisName}>{countryName(c.code)}</span>
                                {c.code === jurisdiction ? (
                                  <span className={styles.jurisCheck}>
                                    <Icon name="check" size={14} />
                                  </span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <TextField
                      label={t('tpl.term')}
                      name="term"
                      placeholder={t('tpl.termPh')}
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                    />
                  </div>
                  <TextField label={t('tpl.details')} name="details" value={details} onChange={(e) => setDetails(e.target.value)} />
                  <div className={styles.modalActions}>
                    <Button type="button" onClick={close}>
                      {t('common.cancel')}
                    </Button>
                    <Button type="submit" variant="primary" icon="sparkle" disabled={busy || !partyA.trim() || !partyB.trim()}>
                      {busy ? t('common.loading') : t('tpl.genRun')}
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2 className={styles.modalTitle}>{t('tpl.genReady')}</h2>
                <pre className={styles.draftPreview}>{draft.content}</pre>
                <div className={styles.modalActions}>
                  <Button onClick={close}>{t('common.close')}</Button>
                  <Button icon="download" onClick={() => downloadContent(draft.title, draft.content)}>
                    {t('tpl.download')}
                  </Button>
                  <Button icon="docs" onClick={() => void copyContent(draft.content)}>
                    {t('tpl.copy')}
                  </Button>
                  <Button variant="primary" icon="check" disabled={saving} onClick={() => void saveDraftAsTemplate()}>
                    {saving ? t('common.loading') : t('tpl.saveAsTemplate')}
                  </Button>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      ) : null}

      {viewSaved ? (
        <div className={styles.modalOverlay} onMouseDown={(e) => e.target === e.currentTarget && setViewSaved(null)}>
          <GlassCard className={styles.modalCard} style={{ maxWidth: 680 }}>
            <h2 className={styles.modalTitle}>{viewSaved.title}</h2>
            <pre className={styles.draftPreview}>{viewSaved.content}</pre>
            <div className={styles.modalActions}>
              <Button onClick={() => setViewSaved(null)}>{t('common.close')}</Button>
              <Button icon="trash" onClick={() => void removeSaved(viewSaved.id)}>
                {t('tpl.delete')}
              </Button>
              <Button icon="download" onClick={() => downloadContent(viewSaved.title, viewSaved.content)}>
                {t('tpl.download')}
              </Button>
              <Button variant="primary" icon="docs" onClick={() => void copyContent(viewSaved.content)}>
                {t('tpl.copy')}
              </Button>
            </div>
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}
