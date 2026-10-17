/**
 * Постоянный номер этого браузера — для «Активных сессий».
 *
 * Без него каждый вход записывал новую сессию, и одно устройство после пары
 * перелогинов показывалось десятком строк. Номер уходит на сервер только при
 * входе: сессия с тем же номером заменяется новой. Он случайный и ничего не
 * говорит о человеке; живёт в localStorage и переживает выход из аккаунта.
 */
const KEY = 'lexai.deviceId';
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

export function deviceId(): string | undefined {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && VALID.test(saved)) return saved;
    const fresh =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return undefined; // хранилище закрыто — вход работает, просто без склейки
  }
}
