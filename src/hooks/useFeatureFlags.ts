/**
 * Рантайм-флаги разделов, приходящие с сервера (`/billing/limits.features`).
 *
 * Зачем: интерфейс не должен предлагать то, что сервер всё равно отклонит.
 * Первым таким разделом стали э-подписи — они закрыты до подключения E-IMZO,
 * и показывать «отправить на подпись» с последующим 503 хуже, чем честное
 * «скоро». Флаг живёт на сервере (ESIGN_ENABLED), чтобы включение не требовало
 * пересборки фронта.
 *
 * Ответ кэшируется на время жизни вкладки — один запрос на все страницы.
 * При сбое сети возвращаются ЗАКРЫТЫЕ флаги (fail-closed): лучше показать
 * «скоро» лишний раз, чем впустить в сценарий, который не работает.
 */
import { useEffect, useState } from 'react';
import { billingApi, type FeatureFlags } from '@/api/billing.api';

/** Флаги + тариф аккаунта: одним запросом на всё приложение. */
export interface RuntimeAccess extends FeatureFlags {
  /** Тариф аккаунта; null — ещё не загружен или запрос не удался. */
  plan: string | null;
}

const CLOSED: RuntimeAccess = { esign: false, plan: null };

let cached: Promise<RuntimeAccess> | null = null;

function load(): Promise<RuntimeAccess> {
  cached ??= billingApi.limits().then(
    (limits) => ({ esign: limits.features?.esign ?? false, plan: limits.plan }),
    () => CLOSED,
  );
  return cached;
}

/** Сбрасывает кэш (используется в тестах и при смене аккаунта). */
export function resetFeatureFlags(): void {
  cached = null;
}

export function useFeatureFlags(): RuntimeAccess {
  const [flags, setFlags] = useState<RuntimeAccess>(CLOSED);
  useEffect(() => {
    let alive = true;
    void load().then((next) => {
      if (alive) setFlags(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return flags;
}
