/** Антивирусный хук (clamd INSTREAM): чистый / заражённый / недоступный.
 *  Настоящий clamd в CI не нужен — поднимаем фейковый TCP-сервер с тем же
 *  протоколом ответов. Env выставляется ДО импорта config (кэш модуля). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

// Env — ДО загрузки config: статические импорты хойстятся, поэтому scan.ts
// подключаем динамически уже после установки переменных.
process.env.CLAMD_HOST = '127.0.0.1';
process.env.CLAMD_PORT = '43331';
const { scanUpload } = await import('../src/lib/scan.ts');

test('scanUpload: unavailable → skipped (fail-open), clean → clean, infected → rejected', async () => {
  // Сервера ещё нет → connection refused → честный fail-open.
  const off = await scanUpload(Buffer.from('hello'));
  assert.equal(off.status, 'skipped');

  let mode: 'clean' | 'infected' = 'clean';
  const server = net.createServer((sock) => {
    // Отвечаем после первого чанка данных — клиент ждёт \0-терминированный ответ.
    sock.once('data', () => {
      setTimeout(() => {
        sock.write(mode === 'clean' ? 'stream: OK\0' : 'stream: Eicar-Test-Signature FOUND\0');
      }, 20);
    });
  });
  await new Promise<void>((resolve) => server.listen(43331, '127.0.0.1', resolve));

  try {
    const clean = await scanUpload(Buffer.from('обычный договор поставки'));
    assert.equal(clean.status, 'clean');

    mode = 'infected';
    // Многочанковый буфер (>64 КБ) — проверяем стриминг INSTREAM.
    const bad = await scanUpload(Buffer.alloc(200_000, 7));
    assert.equal(bad.status, 'infected');
    assert.match(bad.signature ?? '', /Eicar/);
  } finally {
    server.close();
  }
});

test('scanUpload: peer-close без ответа НЕ вешает промис (fail-open)', async () => {
  // Крашлупящийся clamd/прокси: принял соединение и закрыл без ответа. Раньше
  // промис не резолвился никогда и POST /uploads висел вечно.
  const server = net.createServer((sock) => {
    sock.once('data', () => sock.destroy()); // FIN без терминированного ответа
  });
  await new Promise<void>((resolve) => server.listen(43331, '127.0.0.1', resolve));
  try {
    const result = await Promise.race([
      scanUpload(Buffer.from('x')),
      new Promise<null>((r) => setTimeout(() => r(null), 3_000)),
    ]);
    assert.ok(result !== null, 'promise must settle on peer-close');
    assert.equal(result!.status, 'skipped');
  } finally {
    server.close();
  }
});
