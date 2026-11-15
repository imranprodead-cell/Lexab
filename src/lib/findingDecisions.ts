import { useCallback, useEffect, useState } from 'react';
import { decisionsApi } from '@/api/decisions.api';

/** Что человек решил по находке разбора. */
export type DecisionKind = 'fixed' | 'ok' | 'assigned';

export interface FindingDecision {
  kind: DecisionKind;
  /** Кто принял решение (или кто передал коллеге) — имя из профиля. */
  who: string;
  /** Когда, ISO. */
  at: string;
  /** Кому передано (только для 'assigned'). */
  to?: string;
  note?: string;
}

/** Окончательное решение: «Передано коллеге» ещё ждёт ответа. */
export const isFinalDecision = (d: FindingDecision | undefined | null): boolean => !!d && d.kind !== 'assigned';

/*
 * Решения хранит сервер (finding_decisions) — их видит вся команда. Здесь —
 * общий кэш на вкладку: карточка в чате и панель «Обзор» рядом с документом
 * показывают одно и то же и обновляются вместе без повторных запросов.
 */
type Rec = Record<string, FindingDecision>;
const cache = new Map<string, Rec>();
const inflight = new Map<string, Promise<Rec>>();
const listeners = new Set<(analysisId: string) => void>();
const emit = (id: string) => listeners.forEach((l) => l(id));

function load(analysisId: string): Promise<Rec> {
  const pending = inflight.get(analysisId);
  if (pending) return pending;
  const p = decisionsApi
    .list(analysisId)
    .then((rec) => {
      cache.set(analysisId, rec);
      emit(analysisId);
      return rec;
    })
    .finally(() => inflight.delete(analysisId));
  inflight.set(analysisId, p);
  return p;
}

function put(analysisId: string, findingId: string, d: FindingDecision | null) {
  const next = { ...(cache.get(analysisId) ?? {}) };
  if (d) next[findingId] = d;
  else delete next[findingId];
  cache.set(analysisId, next);
  emit(analysisId);
}

export function useFindingDecisions(analysisId: string | null | undefined) {
  const [map, setMap] = useState<Rec>(() => (analysisId ? cache.get(analysisId) ?? {} : {}));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!analysisId) {
      setMap({});
      return;
    }
    const on = (id: string) => {
      if (id === analysisId) setMap(cache.get(analysisId) ?? {});
    };
    listeners.add(on);
    setMap(cache.get(analysisId) ?? {});
    setError(false);
    // Свежие решения коллег — при каждом открытии разбора (кэш показывается сразу).
    load(analysisId).catch(() => setError(true));
    return () => {
      listeners.delete(on);
    };
  }, [analysisId]);

  /**
   * Сохранить решение: сразу на экране, затем на сервере. Ошибка сервера
   * возвращает прежнее состояние и пробрасывается — вызывающий покажет тост.
   */
  const set = useCallback(
    async (findingId: string, d: FindingDecision | null): Promise<void> => {
      if (!analysisId) return;
      const before = cache.get(analysisId)?.[findingId] ?? null;
      put(analysisId, findingId, d);
      try {
        if (d) put(analysisId, findingId, await decisionsApi.set(analysisId, findingId, d));
        else await decisionsApi.clear(analysisId, findingId);
      } catch (err) {
        put(analysisId, findingId, before);
        throw err;
      }
    },
    [analysisId],
  );

  return { map, set, error };
}
