/**
 * Человеческое название устройства из строки браузера (User-Agent) для
 * «Активных сессий»: «Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) …
 * Version/26.6.2 Safari/605.1.15» → «Safari · macOS».
 *
 * Порядок проверок важен: Edge, Opera, Яндекс и Samsung тоже пишут в строку
 * «Chrome» и «Safari», строка iPhone содержит «Mac OS X», Android — «Linux».
 * Не узнали ничего — null (интерфейс покажет «Неизвестное устройство»).
 */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Macintosh|Mac OS X/.test(ua)
              ? 'macOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  const browser = /EdgiOS|EdgA\/|Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|OPT\/|Opera/.test(ua)
      ? 'Opera'
      : /YaBrowser/.test(ua)
        ? 'Yandex Browser'
        : /SamsungBrowser/.test(ua)
          ? 'Samsung Internet'
          : /Firefox\/|FxiOS/.test(ua)
            ? 'Firefox'
            : /CriOS|Chrome\//.test(ua)
              ? 'Chrome'
              : /Safari\//.test(ua) && /Version\//.test(ua)
                ? 'Safari'
                : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os;
}
