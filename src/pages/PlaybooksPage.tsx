import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { playbooksApi } from '@/api';
import { ApiError } from '@/api/util';
import { useAsync } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { Playbook } from '@/types/domain';
import styles from './pages.module.css';

/** Corpus jurisdiction codes a playbook can target (plus "All" = null). */
const JURISDICTIONS = ['UK', 'UZ', 'KZ', 'DE', 'US', 'CA', 'AE'] as const;
/** Sentinel used by the <select> to represent the null (global) jurisdiction. */
const ALL = 'ALL';

interface EditorForm {
  name: string;
  /** Jurisdiction code, or the ALL sentinel for a global playbook. */
  jurisdiction: string;
  active: boolean;
  rules: string[];
}

const emptyForm: EditorForm = { name: '', jurisdiction: ALL, active: true, rules: [''] };

/**
 * Playbooks editor: a team's standard positions (rules). Active playbooks are
 * checked by the AI during analysis, which flags deviating clauses. Pro+ feature
 * — the API answers 402 on lower plans, surfaced here as an upsell.
 */
export function PlaybooksPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('playbooks.title'));

  // useAsync: revisiting the section renders instantly from the session cache
  // and revalidates silently. The 402 "not on Pro+" answer is a VIEW (cached
  // too); buying a plan calls clearAsyncCache(), which re-runs the fetcher.
  // Create/save/delete call reload() — a silent refresh, no skeleton flash.
  const { data: view, loading, error, reload, mutate } = useAsync<{ locked: true } | { locked: false; rows: Playbook[] }>(
    async (signal) => {
      try {
        return { locked: false, rows: await playbooksApi.list(signal) };
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) return { locked: true };
        throw err;
      }
    },
    [],
  );
  const locked = view?.locked === true;
  const data = view && !view.locked ? view.rows : null;

  // Готовые экспертные наборы: живут в модалке за кнопкой «Готовые наборы»
  // (в шапке и на пустом экране), установка — один клик.
  const { data: packs } = useAsync((signal) => playbooksApi.packs(signal), []);
  const [packsOpen, setPacksOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const installedNames = new Set((data ?? []).map((p) => p.name));
  const install = async (packId: string) => {
    if (installing) return;
    setInstalling(packId);
    try {
      const pb = await playbooksApi.installPack(packId, lang);
      mutate((v) => (v && !v.locked ? { locked: false, rows: [pb, ...v.rows.filter((r) => r.id !== pb.id)] } : v));
      pushToast(t('playbooks.packInstalled'), 'success');
      reload();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setInstalling(null);
    }
  };

  // Editor modal state — `editing` is the playbook being edited, or null on create.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, rules: [''] });
    setFormError(null);
    setConfirmDelete(false);
    setEditorOpen(true);
  };

  const openEdit = (pb: Playbook) => {
    setEditing(pb);
    setForm({
      name: pb.name,
      jurisdiction: pb.jurisdiction ?? ALL,
      active: pb.active,
      rules: pb.rules.length ? [...pb.rules] : [''],
    });
    setFormError(null);
    setConfirmDelete(false);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setConfirmDelete(false);
  };

  const setRule = (i: number, value: string) =>
    setForm((f) => ({ ...f, rules: f.rules.map((r, idx) => (idx === i ? value : r)) }));
  const addRule = () => setForm((f) => ({ ...f, rules: [...f.rules, ''] }));
  const removeRule = (i: number) =>
    setForm((f) => {
      const next = f.rules.filter((_, idx) => idx !== i);
      return { ...f, rules: next.length ? next : [''] };
    });

  const jurisdictionLabel = (code: string | null) =>
    code == null ? t('playbooks.allJurisdictions') : code;

  const save = async () => {
    const name = form.name.trim();
    const rules = form.rules.map((r) => r.trim()).filter(Boolean);
    const jurisdiction = form.jurisdiction === ALL ? null : form.jurisdiction;
    if (!name) {
      setFormError(t('playbooks.needName'));
      return;
    }
    if (rules.length === 0) {
      setFormError(t('playbooks.needRule'));
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      if (editing) {
        const updated = await playbooksApi.update(editing.id, { name, jurisdiction, active: form.active, rules });
        // Мгновенно показать результат из ответа сервера; reload() тихо сверит.
        mutate((v) => (v && !v.locked ? { locked: false, rows: v.rows.map((r) => (r.id === updated.id ? updated : r)) } : v));
        pushToast(t('playbooks.savedToast'), 'success');
      } else {
        // Один POST с выключателем: двухшаговое «создать активным → выключить»
        // при сбое второго запроса оставляло плейбук активным, а повтор
        // после ошибки создавал дубликаты.
        const created = await playbooksApi.create({ name, jurisdiction, rules, active: form.active });
        mutate((v) => (v && !v.locked ? { locked: false, rows: [created, ...v.rows.filter((r) => r.id !== created.id)] } : v));
        pushToast(t('playbooks.createdToast'), 'success');
      }
      closeEditor();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!editing) return;
    setDeleteBusy(true);
    try {
      await playbooksApi.remove(editing.id);
      const removedId = editing.id;
      mutate((v) => (v && !v.locked ? { locked: false, rows: v.rows.filter((r) => r.id !== removedId) } : v));
      pushToast(t('playbooks.deletedToast'), 'default');
      closeEditor();
      reload();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopBar title={t('playbooks.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div
            className={styles.pageHead}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}
          >
            <div>
              <h1 className={styles.pageTitle}>{t('playbooks.title')}</h1>
              <p className={styles.pageSub}>{t('playbooks.sub')}</p>
            </div>
            {/* Кнопки в шапке — только при непустом списке: на пустом экране
                свои кнопки в центре, две одинаковые рядом не нужны. */}
            {!locked && !loading && !error && (data ?? []).length > 0 ? (
              <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
                {(packs ?? []).length > 0 ? (
                  <Button variant="secondary" icon="layout" onClick={() => setPacksOpen(true)}>
                    {t('playbooks.packsTitle')}
                  </Button>
                ) : null}
                <Button variant="primary" icon="plus" onClick={openCreate}>
                  {t('playbooks.new')}
                </Button>
              </div>
            ) : null}
          </div>

          {loading ? (
            <SkeletonRows rows={3} height={110} />
          ) : locked ? (
            <EmptyState
              icon="shield"
              title={t('playbooks.upsellTitle')}
              body={t('playbooks.upsellBody')}
              action={
                <Button variant="primary" icon="diamond" onClick={() => navigate('/plans')}>
                  {t('playbooks.upsellCta')}
                </Button>
              }
            />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : (data ?? []).length === 0 ? (
            <EmptyState
              icon="shield"
              title={t('playbooks.empty')}
              body={t('playbooks.emptyBody')}
              action={
                <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {(packs ?? []).length > 0 ? (
                    <Button variant="secondary" icon="layout" onClick={() => setPacksOpen(true)}>
                      {t('playbooks.packsTitle')}
                    </Button>
                  ) : null}
                  <Button variant="primary" icon="plus" onClick={openCreate}>
                    {t('playbooks.new')}
                  </Button>
                </div>
              }
            />
          ) : (
            <div className={styles.grid}>
              {(data ?? []).map((pb) => (
                <div key={pb.id} className={styles.card} onClick={() => openEdit(pb)}>
                  <div className={styles.cardIcon}>
                    <Icon name="shield" size={20} />
                  </div>
                  <div className={styles.cardTitle}>{pb.name}</div>
                  <ul className={styles.pbRuleList}>
                    {pb.rules.slice(0, 3).map((r, i) => (
                      <li key={i} className={styles.pbRuleItem}>
                        {r}
                      </li>
                    ))}
                    {pb.rules.length > 3 ? (
                      <li className={styles.pbRuleMore}>{t('playbooks.rulesMore', { n: pb.rules.length - 3 })}</li>
                    ) : null}
                  </ul>
                  <div className={styles.cardFoot}>
                    <span>{jurisdictionLabel(pb.jurisdiction)}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Badge color={pb.active ? 'Low' : 'var(--mut)'} plain>
                        {pb.active ? t('playbooks.activeBadge') : t('playbooks.inactiveBadge')}
                      </Badge>
                      {t('playbooks.rulesCount', { n: pb.rules.length })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Витрина готовых наборов: не закрывается после установки — часто
          ставят несколько; карточка сама переключается на «установлено». */}
      <Modal open={packsOpen} title={t('playbooks.packsTitle')} onClose={() => setPacksOpen(false)} maxWidth={640}>
        <p className={styles.pageSub} style={{ margin: '0 0 14px' }}>{t('playbooks.packsSub')}</p>
        <div className={styles.grid}>
          {(packs ?? []).map((pack) => {
            const name = lang === 'en' ? pack.nameEn : pack.nameRu;
            const installed = installedNames.has(name);
            return (
              <div key={pack.id} className={styles.card} style={{ cursor: 'default' }}>
                <div className={styles.cardIcon}>
                  <Icon name="layout" size={20} />
                </div>
                <div className={styles.cardTitle}>{name}</div>
                <p className={styles.pageSub} style={{ margin: '4px 0 10px', fontSize: 13 }}>
                  {lang === 'en' ? pack.descEn : pack.descRu}
                </p>
                <div className={styles.cardFoot}>
                  <span>{jurisdictionLabel(pack.jurisdiction)} · {t('playbooks.rulesCount', { n: pack.rulesCount })}</span>
                  <Button
                    size="sm"
                    variant={installed ? 'secondary' : 'primary'}
                    disabled={installed || installing === pack.id}
                    onClick={() => void install(pack.id)}
                  >
                    {installed ? t('playbooks.packInstalledBadge') : installing === pack.id ? t('common.loading') : t('playbooks.packInstall')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={editorOpen}
        title={editing ? t('playbooks.edit') : t('playbooks.create')}
        onClose={closeEditor}
        maxWidth={520}
        footer={
          editing ? (
            confirmDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', width: '100%' }}>
                <span className={styles.metaText}>{t('playbooks.deleteConfirm')}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleteBusy}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="primary" icon="trash" disabled={deleteBusy} onClick={() => void doDelete()}>
                    {deleteBusy ? t('common.loading') : t('playbooks.delete')}
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  {t('playbooks.delete')}
                </Button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" onClick={closeEditor} disabled={saving}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
                    {saving ? t('common.loading') : t('playbooks.save')}
                  </Button>
                </div>
              </div>
            )
          ) : (
            <>
              <Button variant="secondary" onClick={closeEditor} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
                {saving ? t('common.loading') : t('playbooks.create')}
              </Button>
            </>
          )
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <TextField
            label={t('playbooks.name')}
            name="playbookName"
            value={form.name}
            placeholder={t('playbooks.namePh')}
            data-autofocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />

          <div className={styles.field}>
            <span className={styles.label}>{t('playbooks.jurisdiction')}</span>
            <SelectMenu
              ariaLabel={t('playbooks.jurisdiction')}
              value={form.jurisdiction}
              onChange={(v) => setForm((f) => ({ ...f, jurisdiction: v }))}
              options={[
                { value: ALL, label: t('playbooks.allJurisdictions') },
                ...JURISDICTIONS.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('playbooks.rules')}</span>
            <p className={styles.modalHint} style={{ marginTop: 0 }}>{t('playbooks.rulesHint')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {form.rules.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      name={`playbookRule${i}`}
                      value={r}
                      placeholder={t('playbooks.rulePh')}
                      onChange={(e) => setRule(i, e.target.value)}
                    />
                  </div>
                  <IconButton
                    icon="trash"
                    label={t('playbooks.removeRule')}
                    size="sm"
                    iconSize={15}
                    disabled={form.rules.length === 1 && !r.trim()}
                    onClick={() => removeRule(i)}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <Button variant="secondary" size="sm" icon="plus" onClick={addRule}>
                {t('playbooks.addRule')}
              </Button>
            </div>
          </div>

          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleLabel}>{t('playbooks.active')}</div>
              <div className={styles.toggleDesc}>{t('playbooks.activeHint')}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.active}
              aria-label={t('playbooks.active')}
              className={styles.switch}
              style={{ background: form.active ? 'var(--accent)' : 'var(--border)' }}
              onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
            >
              <span className={styles.switchKnob} style={{ transform: form.active ? 'translateX(18px)' : 'none' }} />
            </button>
          </div>

          {formError ? <p className={styles.modalError}>{formError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
