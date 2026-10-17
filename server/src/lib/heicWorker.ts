/**
 * Поток для расшифровки HEIC — формата, в котором iPhone сохраняет фото.
 *
 * libheif работает в wasm СИНХРОННО: 12-мегапиксельный снимок держит поток
 * секунду-две. В общем потоке сервер на это время перестал бы отвечать всем
 * остальным пользователям (а фото договора — это до 20 снимков подряд). Поэтому
 * расшифровка живёт здесь, а главный поток только ждёт сообщения.
 *
 * Протокол: { id, buffer } → { id, width, height, data } | { id, error }.
 * Буферы передаются без копирования (transfer list).
 */
import { parentPort } from 'node:worker_threads';
import decode from 'heic-decode';

parentPort?.on('message', async (msg: { id: number; buffer: ArrayBuffer }) => {
  try {
    const img = await decode({ buffer: new Uint8Array(msg.buffer) });
    const data = img.data.buffer as ArrayBuffer;
    parentPort?.postMessage({ id: msg.id, width: img.width, height: img.height, data }, [data]);
  } catch (err) {
    parentPort?.postMessage({ id: msg.id, error: (err as Error).message || 'HEIC decode failed' });
  }
});
