import { useEffect } from 'react';
import { useUIStore } from '@/store/useUIStore';

/**
 * Pushes a toast when the connection drops or is restored. Mounted once in
 * AppShell. The API client also refuses requests while offline (see client.ts).
 */
export function useNetworkStatus() {
  const pushToast = useUIStore((s) => s.pushToast);

  useEffect(() => {
    const onOffline = () => pushToast('Соединение потеряно — работаем офлайн.', 'error');
    const onOnline = () => pushToast('Соединение восстановлено.', 'success');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [pushToast]);
}
