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
import { TEMPLATES } from '@/data/seed';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { Template } from '@/types/domain';
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

/** Reusable clause/document library + AI contract generator. */
export function TemplatesPage() {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [category, setCategory] = useState('All');

  const categories = useMemo(() => ['All', ...Array.from(new Set(TEMPLATES.map((tpl) => tpl.category)))], []);

  const { data, loading, error, reload } = useAsync((signal) => templatesApi.list(category, signal), [category]);
  const rows = data ?? [];

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

  const countryName = (code: string) =>
    lang === 'ru'
      ? (JURISDICTIONS.find((c) => c.code === code)?.name ?? code)
      : (JURISDICTION_EN[code] ?? code);
  const selectedJuris = JURISDICTIONS.find((c) => c.code === jurisdiction) ?? JURISDICTIONS[0];

  const openGenerator = (template: Template) => {
    setTpl(template);
    setJurisdiction(matchJurisdiction(template.jurisdiction));
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

  const downloadDraft = () => {
    if (!draft) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${draft.title}</title></head><body><pre style="font-family:Georgia,serif;font-size:12pt;white-space:pre-wrap;">${draft.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre></body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.title.replace(/[^\wа-яА-ЯёЁ -]+/g, '').slice(0, 80)}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.content);
      pushToast(t('tpl.copied'), 'success');
    } catch {
      pushToast(t('common.error'), 'error');
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

          <div className={styles.toolbar}>
            <SelectMenu
              ariaLabel="category"
              value={category}
              options={categories.map((c) => ({ value: c, label: c === 'All' ? t('tpl.allCategories') : c }))}
              onChange={setCategory}
            />
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
                  <div className={styles.cardTitle}>{template.name}</div>
                  <div className={styles.cardDesc}>{template.description}</div>
                  <div className={styles.cardFoot}>
                    <span>{template.category}</span>
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
                  {t('tpl.genTitle')} · {tpl.name}
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
                      placeholder="12 months"
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
                  <Button icon="download" onClick={downloadDraft}>
                    {t('tpl.download')}
                  </Button>
                  <Button variant="primary" icon="docs" onClick={() => void copyDraft()}>
                    {t('tpl.copy')}
                  </Button>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}
