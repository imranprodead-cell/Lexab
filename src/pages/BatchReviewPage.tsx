import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { batchApi } from '@/api';
import { uploadsApi } from '@/api/uploads.api';
import { ApiError } from '@/api/util';
import { COUNTRIES, countryName } from '@/data/countries';
import { useAsync } from '@/hooks/useAsync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { BatchItem, BatchJob } from '@/types/domain';
import styles from './pages.module.css';

const ACCEPT = '.pdf,.doc,.docx,.txt,.md';
const MAX_FILES = 20;
const POLL_MS = 2500;

/** A file staged for upload, with its per-file progress state. */
interface Picked {
  key: string;
  file: File;
  status: 'idle' | 'uploading' | 'done' | 'error';
  /** Причина сбоя загрузки (текст сервера: квота, тип, размер) — показывается
   *  прямо в строке файла, а не глотается молча. */
  error?: string;
}

/** Типы и размер как в одиночной загрузке чата — чтобы негодный файл падал
 *  сразу с понятной причиной, а не тихо выпадал из задания на старте. */
const BATCH_ACCEPTED = /\.(pdf|docx?|txt)$/i;
const BATCH_MAX_BYTES = 10 * 1024 * 1024;

const ITEM_TONE: Record<BatchItem['status'], string> = {
  queued: 'var(--mut)',
  processing: 'var(--accent)',
  done: 'var(--sev-low)',
  error: 'var(--sev-high)',
};

/**
 * Batch review: upload a pack of contracts and analyse them in one job, then
 * poll the job for progress. Pro+ feature — the API answers 402 on lower plans,
 * surfaced here as an upsell.
 */
export function BatchReviewPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 700px)');
  const pushToast = useUIStore((s) => s.pushToast);
  const country = useUIStore((s) => s.country);
  usePageTitle(t('batch.title'));

  const [files, setFiles] = useState<Picked[]>([]);
  const [jurisdiction, setJurisdiction] = useState(country);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // The job currently being viewed (with items). null = compose view.
  const [job, setJob] = useState<BatchJob | null>(null);

  // History list via useAsync: revisiting the section renders instantly from
  // the session cache and revalidates silently. The 402 "not on Pro+" answer
  // is a VIEW (cached too); buying a plan calls clearAsyncCache(). reload()
  // doubles as the old silent refreshHistory (no skeleton over the job view).
  // The job POLLING below stays manual — dynamic stop conditions are not
  // useAsync's job.
  const { data: historyView, loading, error, reload: refreshHistory, mutate: mutateHistory } = useAsync<
    { locked: true } | { locked: false; rows: BatchJob[] }
  >(
    async (signal) => {
      try {
        return { locked: false, rows: await batchApi.list(signal) };
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) return { locked: true };
        throw err;
      }
    },
    [],
  );
  const locked = historyView?.locked === true;
  const history = historyView && !historyView.locked ? historyView.rows : null;

  // Poll the viewed job until it is done, then stop. Re-armed only when the id
  // or the status changes, so the interval survives progress updates.
  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || jobStatus === 'done') return;
    let cancelled = false;
    const poll = () =>
      batchApi
        .get(jobId)
        .then((j) => {
          if (!cancelled) setJob(j);
        })
        .catch(() => undefined);
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [jobId, jobStatus]);

  const formatSize = (bytes: number): string =>
    bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  const timeAgo = (iso: string): string => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return t('docs.today');
    if (days === 1) return t('docs.yesterday');
    return t('docs.daysAgo', { n: days });
  };

  const riskLabel = (level: string): string =>
    level === 'Low' || level === 'Elevated' || level === 'High' ? t(`risk.${level}`) : level;

  const addFiles = (list: FileList | File[]) => {
    const all = Array.from(list);
    const incoming = all.filter((file) => {
      if (!BATCH_ACCEPTED.test(file.name)) {
        pushToast(`${file.name}: ${t('chat.fileTypes')}`, 'error');
        return false;
      }
      if (file.size > BATCH_MAX_BYTES) {
        pushToast(`${file.name}: ${t('chat.fileTooBig')}`, 'error');
        return false;
      }
      return true;
    });
    setFiles((cur) => {
      const room = MAX_FILES - cur.length;
      if (room <= 0) {
        pushToast(t('batch.maxReached'), 'default');
        return cur;
      }
      const next = incoming.slice(0, room).map((file, i) => ({
        key: `pf_${Date.now()}_${i}_${file.name}`,
        file,
        status: 'idle' as const,
      }));
      if (incoming.length > room) pushToast(t('batch.maxReached'), 'default');
      return [...cur, ...next];
    });
  };

  const removeFile = (key: string) => setFiles((cur) => cur.filter((f) => f.key !== key));

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const setFileStatus = (key: string, status: Picked['status']) =>
    setFiles((cur) => cur.map((f) => (f.key === key ? { ...f, status } : f)));

  const start = async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    const ids: string[] = [];
    // Upload sequentially so each row shows its own progress; a failed file is
    // marked and skipped, the rest continue.
    let failed = 0;
    let firstError = '';
    for (const pf of files) {
      setFileStatus(pf.key, 'uploading');
      try {
        const up = await uploadsApi.upload(pf.file);
        ids.push(up.id);
        setFileStatus(pf.key, 'done');
      } catch (err) {
        // Настоящая причина (квота хранилища 402, тип, размер) остаётся В
        // СТРОКЕ файла — молча выброшенный из задания файл выглядел как баг.
        failed += 1;
        const msg = err instanceof Error && err.message ? err.message : t('common.error');
        if (!firstError) firstError = msg;
        setFiles((cur) => cur.map((f) => (f.key === pf.key ? { ...f, status: 'error', error: msg } : f)));
      }
    }
    if (ids.length === 0) {
      pushToast(firstError || t('batch.noneUploaded'), 'error');
      setBusy(false);
      return;
    }
    if (failed > 0) pushToast(t('batch.someFailed', { n: failed }), 'error');
    try {
      const law = COUNTRIES.find((c) => c.code === jurisdiction)?.law;
      const created = await batchApi.start(ids, law);
      setJob(created);
      // Ошибочные строки остаются на экране с причиной — их можно поправить
      // (освободить место, заменить файл) и дослать отдельным заданием.
      setFiles((cur) => cur.filter((f) => f.status === 'error'));
      // Мгновенно добавить задачу в историю; reload тихо сверит с сервером.
      mutateHistory((v) => (v && !v.locked ? { locked: false, rows: [created, ...v.rows.filter((r) => r.id !== created.id)] } : v));
      void refreshHistory(); // silent — don't flash the page skeleton over the job view
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openJob = (id: string) => {
    setJob(null);
    batchApi
      .get(id)
      .then(setJob)
      .catch((err) => pushToast(err instanceof Error ? err.message : t('common.error'), 'error'));
  };

  const backToCompose = () => {
    setJob(null);
    void refreshHistory(); // reflect a just-finished job in the list
  };

  const openDocument = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    navigate(`/documents/${id}`);
  };

  const progressPct = useMemo(() => {
    if (!job || job.total === 0) return 0;
    return Math.round(((job.done + job.failed) / job.total) * 100);
  }, [job]);

  const itemStatusCell = (item: BatchItem) => {
    const tone = ITEM_TONE[item.status];
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {item.status === 'processing' ? <Spinner size={14} /> : null}
        <Badge color={tone} plain>
          {t(`batch.status.${item.status}`)}
        </Badge>
      </span>
    );
  };

  const renderJob = (j: BatchJob) => (
    <>
      <div className={styles.batchJobHead}>
        <Button variant="secondary" size="sm" icon="back" onClick={backToCompose}>
          {t('batch.newBatch')}
        </Button>
        {j.status !== 'done' ? (
          <span className={styles.batchWorking}>
            <Spinner size={14} />
            {t(`batch.status.${j.status}`)}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Badge color="var(--sev-low)" plain>
              {t('batch.jobDone')}
            </Badge>
            {/* Сводный отчёт: один HTML со всеми договорами по риску. */}
            <Button
              size="sm"
              icon="download"
              onClick={() => void batchApi.downloadReport(j.id).catch(() => pushToast(t('common.error'), 'error'))}
            >
              {t('batch.report')}
            </Button>
          </span>
        )}
      </div>

      <div className={styles.progressRow}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
        </div>
        <span className={styles.progressLabel}>
          {t('batch.progress', { done: j.done + j.failed, total: j.total })}
          {j.failed > 0 ? ` · ${t('batch.failedCount', { n: j.failed })}` : ''}
        </span>
      </div>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t('batch.col.file')}</th>
              <th className={styles.th}>{t('batch.col.status')}</th>
              <th className={styles.th}>{t('batch.col.risk')}</th>
              <th className={`${styles.th} ${styles.hideSm}`}>{t('batch.col.findings')}</th>
            </tr>
          </thead>
          <tbody>
            {(j.items ?? []).map((item) => (
              <tr key={item.id} className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.docCell}>
                    <div className={styles.docCellIcon}>
                      <Icon name="docs" size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {item.status === 'done' && item.documentId ? (
                        <div
                          className={styles.docCellName}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => openDocument(e, item.documentId!)}
                        >
                          {item.fileName}
                        </div>
                      ) : (
                        <div className={styles.docCellName} style={{ cursor: 'default' }}>
                          {item.fileName}
                        </div>
                      )}
                      {item.status === 'error' && item.error ? (
                        <div className={styles.batchError}>{item.error}</div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className={styles.td}>{itemStatusCell(item)}</td>
                <td className={styles.td}>
                  {item.riskLevel ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {item.riskScore != null ? <span className={styles.mono}>{item.riskScore}</span> : null}
                      <Badge color={item.riskLevel} plain>
                        {riskLabel(item.riskLevel)}
                      </Badge>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${styles.td} ${styles.hideSm}`}>{item.findingsCount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderCompose = () => (
    <>
      <div
        className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={t('batch.pick')}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className={styles.dropIcon}>
          <Icon name="upload" size={22} color="var(--accent)" />
        </div>
        <div className={styles.dropTitle}>{t('batch.dropHint')}</div>
        <div className={styles.dropSub}>{t('batch.maxHint')}</div>
      </div>

      {files.length > 0 ? (
        <div className={styles.batchFileList}>
          {files.map((f) => (
            <div key={f.key} className={styles.batchFileRow}>
              <Icon name="docs" size={16} color="var(--accent)" />
              <span className={styles.batchFileName}>{f.file.name}</span>
              <span className={styles.batchFileMeta} title={f.error} style={f.status === 'error' ? { color: 'var(--danger)' } : undefined}>
                {f.status === 'uploading'
                  ? t('batch.uploading')
                  : f.status === 'done'
                    ? t('batch.status.done')
                    : f.status === 'error'
                      ? f.error || t('batch.status.error')
                      : formatSize(f.file.size)}
              </span>
              {!busy ? (
                <IconButton icon="x" label={t('batch.remove')} size="sm" iconSize={15} onClick={() => removeFile(f.key)} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.batchControls}>
        <div className={styles.field}>
          <span className={styles.label}>{t('batch.jurisdiction')}</span>
          <SelectMenu
            ariaLabel={t('batch.jurisdiction')}
            value={jurisdiction}
            disabled={busy}
            onChange={setJurisdiction}
            options={COUNTRIES.map((c) => ({ value: c.code, label: countryName(c, lang) }))}
          />
        </div>
        <Button variant="primary" icon="sparkle" disabled={files.length === 0 || busy} onClick={() => void start()}>
          {busy ? t('batch.submitting') : t('batch.start')}
        </Button>
      </div>

      <div className={styles.batchHistory}>
        <h2 className={styles.batchHistoryTitle}>{t('batch.history')}</h2>
        {(history ?? []).length === 0 ? (
          <p className={styles.panelEmpty}>{t('batch.noHistory')}</p>
        ) : isMobile ? (
          <div className={styles.rowCards}>
            {(history ?? []).map((h) => (
              <div key={h.id} className={styles.rowCard} onClick={() => openJob(h.id)}>
                <div className={styles.rowCardHead}>
                  <div className={styles.docCellIcon}>
                    <Icon name="inbox" size={16} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className={styles.docCellName} style={{ cursor: 'default' }}>
                      {t('batch.jobLabel', { n: h.total })}
                    </div>
                    <div className={styles.docCellSub}>{timeAgo(h.createdAt)}</div>
                  </div>
                  <Badge color={h.status === 'done' ? 'var(--sev-low)' : 'var(--accent)'} plain>
                    {t(`batch.status.${h.status}`)}
                  </Badge>
                </div>
                <div className={styles.rowCardMeta}>
                  <span>{t('batch.summary', { done: h.done, total: h.total })}</span>
                  {h.failed > 0 ? <span>{t('batch.failedCount', { n: h.failed })}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>{t('batch.col.job')}</th>
                  <th className={styles.th}>{t('batch.col.status')}</th>
                  <th className={styles.th}>{t('batch.col.result')}</th>
                  <th className={`${styles.th} ${styles.hideSm}`}>{t('batch.col.created')}</th>
                </tr>
              </thead>
              <tbody>
                {(history ?? []).map((h) => (
                  <tr key={h.id} className={styles.tr} onClick={() => openJob(h.id)}>
                    <td className={styles.td}>
                      <div className={styles.docCell}>
                        <div className={styles.docCellIcon}>
                          <Icon name="inbox" size={16} />
                        </div>
                        <div className={styles.docCellName}>{t('batch.jobLabel', { n: h.total })}</div>
                      </div>
                    </td>
                    <td className={styles.td}>
                      <Badge color={h.status === 'done' ? 'var(--sev-low)' : 'var(--accent)'} plain>
                        {t(`batch.status.${h.status}`)}
                      </Badge>
                    </td>
                    <td className={styles.td}>
                      <span className={styles.metaText}>
                        {t('batch.summary', { done: h.done, total: h.total })}
                        {h.failed > 0 ? ` · ${t('batch.failedCount', { n: h.failed })}` : ''}
                      </span>
                    </td>
                    <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>{timeAgo(h.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={styles.page}>
      <TopBar title={t('batch.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('batch.title')}</h1>
            <p className={styles.pageSub}>{t('batch.sub')}</p>
          </div>

          {loading ? (
            <SkeletonRows rows={4} height={80} />
          ) : locked ? (
            <EmptyState
              icon="inbox"
              title={t('batch.upsellTitle')}
              body={t('batch.upsellBody')}
              action={
                <Button variant="primary" icon="diamond" onClick={() => navigate('/plans')}>
                  {t('batch.upsellCta')}
                </Button>
              }
            />
          ) : error ? (
            <ErrorState message={error} onRetry={refreshHistory} />
          ) : job ? (
            renderJob(job)
          ) : (
            renderCompose()
          )}
        </div>
      </div>
    </div>
  );
}
