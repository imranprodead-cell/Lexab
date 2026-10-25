import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useVaultCounts } from '@/hooks/useVaultCounts';
import { useI18n } from '@/i18n/I18nProvider';
import { VAULT_TABS, type VaultTab } from '@/lib/vault';
import styles from '@/pages/pages.module.css';

/**
 * Шапка Vault (эталон владельца): заголовок, подзаголовок и вкладки со
 * счётчиками — Documents · Playbooks · Contracts · Batch review. Стоит вместо
 * собственных заголовков четырёх страниц; под вкладками — кнопки текущего
 * раздела (actions), если они у него есть. Кнопку «Загрузить договор»
 * владелец убрал 2026-10-25: договор прикрепляют в чате.
 */
export function VaultHeader({ active, actions }: { active: VaultTab; actions?: ReactNode }) {
  const { t } = useI18n();
  const counts = useVaultCounts();

  return (
    <div className={styles.vaultHead}>
      <div className={styles.vaultTitleRow}>
        <div style={{ minWidth: 0 }}>
          <h1 className={styles.vaultTitle}>{t('nav.documents')}</h1>
          <p className={styles.vaultSub}>{t('vault.sub')}</p>
        </div>
      </div>

      <nav className={styles.vaultTabs} aria-label={t('nav.documents')}>
        {VAULT_TABS.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.to}
            className={tab.key === active ? `${styles.vaultTab} ${styles.vaultTabOn}` : styles.vaultTab}
            aria-current={tab.key === active ? 'page' : undefined}
          >
            {t(tab.label)}
            {counts[tab.key] !== undefined ? <span className={styles.vaultCount}>{counts[tab.key]}</span> : null}
          </NavLink>
        ))}
      </nav>

      {actions ? <div className={styles.vaultActions}>{actions}</div> : null}
    </div>
  );
}
