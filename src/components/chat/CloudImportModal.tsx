import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { Spinner } from '@/components/ui/Spinner';
import { useAsync } from '@/hooks/useAsync';
import { BrandLogo } from '@/components/icons/BrandLogos';
import { integrationsApi, type CloudFile, type CloudProvider } from '@/api/integrations.api';
import { GDOC_MIME, openDrivePicker } from '@/lib/googlePicker';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
import { formatFileSize } from '@/lib/format';
import styles from '@/pages/pages.module.css';

interface CloudImportModalProps {
  open: boolean;
  onClose: () => void;
  /** The picked file is already on the server as an upload — analyse away. */
  onImported: (file: { name: string; size: string }) => void;
}

/** Browse a connected cloud drive and pull a contract into Lexab. */
export function CloudImportModal({ open, onClose, onImported }: CloudImportModalProps) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);

  const integrations = useAsync((signal) => integrationsApi.list(signal), [open]);
  const connected = useMemo(
    () => (integrations.data ?? []).filter((i) => i.connected),
    [integrations.data],
  );

  const [provider, setProvider] = useState<CloudProvider | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [files, setFiles] = useState<CloudFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState('');

  const active = provider ?? connected[0]?.provider ?? null;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // (Re)load the file list when the modal opens / tab or search changes.
  // All providers (Google Drive included) browse via OUR server — Google's
  // embedded picker needed third-party cookies and broke in Safari/incognito.
  useEffect(() => {
    if (!open || !active) return;
    let alive = true;
    setFiles(null);
    setListError(null);
    integrationsApi
      .files(active, debounced)
      .then((rows) => {
        if (alive) setFiles(rows);
      })
      .catch((err) => {
        if (alive) setListError(err instanceof Error ? err.message : t('common.error'));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, debounced]);

  // Google Drive, primary path: Google's own picker (drive.file scope — the
  // app only ever sees the files the user picks; free tier, no verification).
  const pickFromDrive = async () => {
    if (importing) return;
    setImporting('__picker');
    try {
      const boot = await integrationsApi.pickerToken();
      const picked = await openDrivePicker({
        accessToken: boot.accessToken,
        apiKey: boot.apiKey || undefined,
        appId: boot.appId || undefined,
        locale: lang === 'ru' ? 'ru' : 'en',
      });
      if (!picked) return; // user closed the picker
      // Google Docs are exported to .docx on import — reflect that in the name.
      const name = picked.mimeType === GDOC_MIME && !/\.docx$/i.test(picked.name) ? `${picked.name}.docx` : picked.name;
      const res = await integrationsApi.importFile('google-drive', picked.id, name);
      onClose();
      onImported({ name: res.fileName, size: res.fileSize });
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setImporting(null);
    }
  };

  // Fallback that needs no third-party cookies (Safari/incognito): the user
  // pastes an "anyone with the link" URL and we fetch it server-side.
  const importDriveLink = async () => {
    const url = driveLink.trim();
    if (!url || importing) return;
    setImporting('__link');
    try {
      const res = await integrationsApi.importByLink(url);
      setDriveLink('');
      onClose();
      onImported({ name: res.fileName, size: res.fileSize });
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setImporting(null);
    }
  };

  const importFile = async (file: CloudFile) => {
    if (!active || importing) return;
    setImporting(file.id);
    try {
      const res = await integrationsApi.importFile(active, file.id, file.name);
      onClose();
      onImported({ name: res.fileName, size: res.fileSize });
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setImporting(null);
    }
  };

  const dateOf = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' }) : '';

  return (
    <Modal open={open} title={t('cloud.title')} onClose={onClose} maxWidth={520}>
      {integrations.loading && !integrations.data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
          <Spinner />
        </div>
      ) : integrations.error && !integrations.data ? (
        <div className={styles.cloudEmpty}>{integrations.error}</div>
      ) : connected.length === 0 ? (
        <div className={styles.cloudEmpty}>
          <p style={{ margin: '0 0 14px' }}>{t('cloud.noneConnected')}</p>
          <Button
            variant="primary"
            icon="cloud"
            onClick={() => {
              onClose();
              navigate('/settings');
            }}
          >
            {t('cloud.goSettings')}
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.cloudTabs}>
            {connected.map((integ) => (
              <button
                key={integ.provider}
                type="button"
                className={`${styles.cloudTab} ${active === integ.provider ? styles.cloudTabActive : ''}`}
                onClick={() => setProvider(integ.provider)}
              >
                <BrandLogo provider={integ.provider} size={15} />
                {integ.label}
              </button>
            ))}
          </div>

          {active === 'google-drive' ? (
            <div className={styles.drivePickBlock}>
              <Button variant="primary" disabled={importing !== null} onClick={() => void pickFromDrive()}>
                <BrandLogo provider="google-drive" size={16} />
                {importing === '__picker' ? t('common.loading') : t('cloud.drivePick')}
              </Button>
              <div className={styles.driveLinkRow}>
                <TextField
                  placeholder={t('cloud.linkPh')}
                  value={driveLink}
                  onChange={(e) => setDriveLink(e.target.value)}
                />
                <Button disabled={importing !== null || !driveLink.trim()} onClick={() => void importDriveLink()}>
                  {importing === '__link' ? t('common.loading') : t('cloud.linkImport')}
                </Button>
              </div>
              <p className={styles.driveLinkHint}>{t('cloud.linkHint')}</p>
            </div>
          ) : null}

          <TextField
            placeholder={t('cloud.search')}
            value={search}
            autoFocus={active !== 'google-drive'}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className={`${styles.cloudList} scroll`} style={{ marginTop: 12 }}>
            {listError ? (
              <div className={styles.cloudEmpty}>{listError}</div>
            ) : files === null ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 26 }}>
                <Spinner />
              </div>
            ) : files.length === 0 ? (
              <div className={styles.cloudEmpty}>{t('cloud.empty')}</div>
            ) : (
              files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={styles.cloudFile}
                  disabled={importing !== null}
                  onClick={() => void importFile(f)}
                >
                  <Icon name="docs" size={16} color="var(--dim)" />
                  <span className={styles.cloudFileName}>{f.name}</span>
                  <span className={styles.cloudFileMeta}>
                    {importing === f.id
                      ? t('cloud.importing')
                      : [f.size !== null ? formatFileSize(f.size) : '', dateOf(f.modifiedAt)].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
