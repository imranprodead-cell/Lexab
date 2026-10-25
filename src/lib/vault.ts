/**
 * Vault — одна вкладка меню вместо четырёх: договоры, плейбуки, сроки
 * (контракты) и массовый разбор (решение владельца 2026-10-25). Адреса
 * страниц прежние — все ссылки сайта продолжают работать. Шаблонов больше
 * нет: документ на любую тему пишет ИИ в чате, а сохранённое из чата лежит
 * в Documents; старый адрес /templates ведёт туда же.
 */
export type VaultTab = 'documents' | 'playbooks' | 'contracts' | 'batch';

export const VAULT_TABS: { key: VaultTab; to: string; label: string }[] = [
  { key: 'documents', to: '/documents', label: 'vault.tab.documents' },
  { key: 'playbooks', to: '/playbooks', label: 'nav.playbooks' },
  { key: 'contracts', to: '/contracts', label: 'nav.contracts' },
  { key: 'batch', to: '/batch', label: 'nav.batch' },
];

/** Адрес внутри Vault? (/documents/:id — тоже Vault). */
export function vaultTabOf(pathname: string): VaultTab | null {
  const hit = VAULT_TABS.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`));
  return hit?.key ?? null;
}
