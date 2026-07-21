/**
 * Антивирусная проверка загружаемых файлов через ClamAV (clamd, TCP INSTREAM).
 *
 * Включается переменной CLAMD_HOST (напр. sidecar-контейнер clamav/clamav на
 * Railway). Без неё проверка честно пропускается со статусом 'skipped' —
 * магазинная сигнатурная валидация (magic bytes) остаётся всегда.
 *
 * Fail-open осознанно: недоступность антивируса не должна останавливать весь
 * приём документов (файлы и так не исполняются сервером — они парсятся и
 * шифруются); каждый пропуск логируется, заражённые файлы отклоняются жёстко.
 */
import net from 'node:net';
import { config } from '../config.ts';

export interface ScanResult {
  status: 'clean' | 'infected' | 'skipped';
  signature?: string;
}

export function scanEnabled(): boolean {
  return Boolean(config.clamdHost);
}

export async function scanUpload(buffer: Buffer): Promise<ScanResult> {
  if (!config.clamdHost) return { status: 'skipped' };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.clamdHost, port: config.clamdPort });
    socket.setTimeout(10_000);
    let settled = false;
    const done = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    let reply = '';
    socket.on('connect', () => {
      // Протокол INSTREAM: команда, затем чанки <длина BE32><байты>, затем 0.
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let off = 0; off < buffer.length; off += CHUNK) {
        const chunk = buffer.subarray(off, off + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length, 0);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
    socket.on('data', (d) => {
      reply += d.toString('utf8');
      if (!reply.includes('\0') && !reply.includes('\n')) return;
      const text = reply.replace(/\0/g, '').trim();
      if (/\bOK$/.test(text)) return done({ status: 'clean' });
      const m = text.match(/:\s*(.+)\s+FOUND$/);
      if (m) return done({ status: 'infected', signature: m[1] });
      console.warn(`[scan] непонятный ответ clamd: "${text.slice(0, 120)}" — пропускаю (fail-open)`);
      done({ status: 'skipped' });
    });
    socket.on('error', (err) => {
      console.warn(`[scan] clamd недоступен (${err.message}) — пропускаю (fail-open)`);
      done({ status: 'skipped' });
    });
    socket.on('timeout', () => {
      console.warn('[scan] clamd timeout — пропускаю (fail-open)');
      done({ status: 'skipped' });
    });
    // Пир закрыл соединение (FIN) без терминатора: без этого обработчика
    // промис не резолвился НИКОГДА (close снимает idle-таймер) и запрос
    // загрузки висел вечно — подтверждено репро ломателя. Парсим то, что
    // успело прийти, иначе честный fail-open.
    socket.on('close', () => {
      const text = reply.replace(/\0/g, '').trim();
      if (/\bOK$/.test(text)) return done({ status: 'clean' });
      const m = text.match(/:\s*(.+)\s+FOUND$/);
      if (m) return done({ status: 'infected', signature: m[1] });
      if (!settled) console.warn('[scan] clamd закрыл соединение без ответа — пропускаю (fail-open)');
      done({ status: 'skipped' });
    });
  });
}
