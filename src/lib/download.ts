/**
 * Единая точка скачивания blob'ов. Критично: URL нельзя отзывать синхронно
 * после click() — iOS Safari и webview мессенджеров читают blob асинхронно,
 * и мгновенный revoke обрывает загрузку на середине (битый/пустой файл).
 * Отзываем через минуту — этого хватает любому мобильному загрузчику.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
