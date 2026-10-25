import { useEffect, useState } from 'react';
import { batchApi } from '@/api/batch.api';
import { contractsApi } from '@/api/contracts.api';
import { documentsApi } from '@/api/documents.api';
import { playbooksApi } from '@/api/playbooks.api';
import { savedDocsApi } from '@/api/savedDocs.api';
import type { VaultTab } from '@/lib/vault';

export type VaultCounts = Partial<Record<VaultTab, number>>;

/** Счётчики на вкладках Vault и в меню: общий кэш на 30 с и один запрос на
 *  всех — шапка и меню просят их одновременно. Раздел недоступен на тарифе
 *  (402) или не загрузился — без числа, а не «0». */
const FRESH_MS = 30_000;
let cache: { at: number; value: VaultCounts } | null = null;
let inflight: Promise<VaultCounts> | null = null;
/** Открытые шапки и меню: после сохранения или удаления пересчитать сразу. */
const listeners = new Set<() => void>();

/** Состав Vault изменился (сохранили документ из чата, удалили его) —
 *  счётчики пересчитываются сразу, а не через 30 с. */
export function invalidateVaultCounts(): void {
  cache = null;
  listeners.forEach((l) => l());
}

async function count(p: Promise<unknown[]>): Promise<number | undefined> {
  try {
    return (await p).length;
  } catch {
    return undefined;
  }
}

function loadCounts(): Promise<VaultCounts> {
  if (inflight) return inflight;
  inflight = Promise.all([
    count(documentsApi.list()),
    count(savedDocsApi.list()),
    count(playbooksApi.list()),
    count(contractsApi.list()),
    count(batchApi.list()),
  ])
    .then(([contractDocs, savedDocs, playbooks, contracts, batch]) => {
      // В Documents лежат и договоры, и сохранённые из чата документы.
      const documents = contractDocs === undefined ? undefined : contractDocs + (savedDocs ?? 0);
      const value: VaultCounts = { documents, playbooks, contracts, batch };
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useVaultCounts(enabled = true): VaultCounts {
  const [counts, setCounts] = useState<VaultCounts>(() => cache?.value ?? {});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () => {
      loadCounts()
        .then((v) => {
          if (alive) setCounts(v);
        })
        .catch(() => undefined);
    };
    listeners.add(refresh);
    if (cache && Date.now() - cache.at < FRESH_MS) setCounts(cache.value);
    else refresh();
    return () => {
      alive = false;
      listeners.delete(refresh);
    };
  }, [enabled]);
  return counts;
}
