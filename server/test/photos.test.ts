/**
 * Фото договора и распознавание сканов (решение владельца 2026-10-17).
 *
 * Отдельный процесс со своим env: Anthropic-ключа нет, поэтому реальное
 * распознавание здесь не выполняется — проверяются гейт тарифа, сборка PDF из
 * снимков, состояния распознавания (один запуск, пауза после сбоя) и то, куда
 * распознанный текст попадает (чат — да, с предупреждением; экспорт — нет).
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-photos-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_FALLBACK = 'dev';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'photos-test-master-key-0123456789abcdef!';
process.env.SEED_DEMO_DATA = 'false';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.BATCH_AUTOSTART = '0';
for (const k of Object.keys(process.env)) if (k.startsWith('LEMONSQUEEZY_')) delete process.env[k];

const { getDb, migrate } = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');
const { detectPhotoKind, photosToPdf } = await import('../src/lib/photos.ts');
const { photoDocName } = await import('../src/routes/uploads.routes.ts');
const { startScanOcr } = await import('../src/lib/ocr.ts');
const { buildAnalysisContext } = await import('../src/routes/chats.routes.ts');
const { encText } = await import('../src/lib/docCrypto.ts');

const db = await getDb();
await migrate(db);
const app = await buildApp(db);
await app.ready();

after(async () => {
  await app.close();
  await db.close();
  fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
});

let counter = 0;
async function makeUser(plan: string): Promise<{ id: string; token: string }> {
  const email = `photo${Date.now()}_${counter++}@test.local`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'T', email, password: 'Passw0rd!123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const row = await db.query<{ id: string; verify_token: string }>('SELECT id, verify_token FROM users WHERE email = $1', [email]);
  await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: row.rows[0].verify_token } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Passw0rd!123' } });
  assert.equal(login.statusCode, 200, login.body);
  await db.query('UPDATE subscriptions SET plan = $2 WHERE user_id = $1', [row.rows[0].id, plan]);
  return { id: row.rows[0].id, token: JSON.parse(login.body).token };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Страница «договора»: белый лист A4-пропорций с текстом. */
const page = (text: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="850"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="80" font-size="28">${text}</text></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();

/** Снимок «боком»: пиксели повёрнуты, а EXIF велит повернуть обратно (как у телефона). */
const sideways = async (text: string) => sharp(await page(text)).rotate(-90).withMetadata({ orientation: 6 }).jpeg().toBuffer();

function multipart(files: { name: string; data: Buffer }[], fields: Record<string, string> = {}) {
  const boundary = '----lexabPhotoBoundary7';
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: image/jpeg\r\n\r\n`));
    chunks.push(f.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadPhotos(token: string, files: { name: string; data: Buffer }[], name = 'Фото договора 17.10.2026 18-42-05.pdf') {
  const body = multipart(files, { name });
  return app.inject({
    method: 'POST',
    url: '/api/uploads/photos',
    headers: { ...auth(token), 'content-type': body.contentType },
    payload: body.payload,
  });
}

describe('фото → PDF', () => {
  it('формат определяется по содержимому, а не по имени', async () => {
    assert.equal(detectPhotoKind(await page('a')), 'jpeg');
    assert.equal(detectPhotoKind(await sharp(await page('a')).png().toBuffer()), 'png');
    assert.equal(detectPhotoKind(await sharp(await page('a')).webp().toBuffer()), 'webp');
    const heicHead = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(12)]);
    assert.equal(detectPhotoKind(heicHead), 'heic');
    assert.equal(detectPhotoKind(Buffer.from('MZ\x90\x00 not an image at all')), null);
  });

  it('страницы идут по порядку и стоят вертикально, снимок «боком» повёрнут по EXIF', async () => {
    const pdf = await photosToPdf([
      { name: '1.jpg', buffer: await page('page one') },
      { name: '2.jpg', buffer: await sideways('page two') },
    ]);
    const doc = await PDFDocument.load(pdf);
    assert.equal(doc.getPageCount(), 2);
    for (const p of doc.getPages()) assert.ok(p.getHeight() > p.getWidth(), 'страница должна стоять вертикально');
  });

  it('не фото → понятный отказ 400 с именем файла', async () => {
    await assert.rejects(photosToPdf([{ name: 'virus.jpg', buffer: Buffer.from('MZ not a photo, just bytes') }]), (err: Error & { status?: number }) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /virus\.jpg/);
      return true;
    });
  });

  it('имя документа: без разделителей путей, всегда .pdf', () => {
    assert.equal(photoDocName('Фото договора 17.10.2026 18-42-05.pdf'), 'Фото договора 17.10.2026 18-42-05.pdf');
    assert.ok(!/[\\/]/.test(photoDocName('../../etc/passwd')));
    assert.match(photoDocName('scan.jpg'), /^scan\.pdf$/);
    assert.match(photoDocName(''), /^Photos .+\.pdf$/);
  });
});

describe('POST /uploads/photos', () => {
  it('бесплатный тариф: отказ 402 «функция тарифа», ничего не сохранено', async () => {
    const u = await makeUser('Free');
    const res = await uploadPhotos(u.token, [{ name: 'a.jpg', data: await page('x') }]);
    assert.equal(res.statusCode, 402, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'feature_locked');
    assert.equal(body.details.feature, 'scans');
    const n = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM uploads WHERE user_id = $1', [u.id]);
    assert.equal(Number(n.rows[0].n), 0);
  });

  it('платный тариф: снимки склеиваются в один PDF-скан', async () => {
    const u = await makeUser('Standard');
    const res = await uploadPhotos(u.token, [
      { name: 'IMG_1.jpg', data: await page('one') },
      { name: 'IMG_2.jpg', data: await sideways('two') },
    ]);
    assert.equal(res.statusCode, 201, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.fileName, 'Фото договора 17.10.2026 18-42-05.pdf');
    assert.equal(body.pages, 2);
    const row = await db.query<{ file_name: string; mime: string; extracted_text: string | null; ocr_status: string | null }>(
      'SELECT file_name, mime, extracted_text, ocr_status FROM uploads WHERE id = $1',
      [body.id],
    );
    assert.equal(row.rows[0].mime, 'application/pdf');
    assert.equal(row.rows[0].extracted_text, null);
    assert.equal(row.rows[0].ocr_status, null);
  });

  it('больше 20 фото — понятный отказ 413', async () => {
    const u = await makeUser('Pro');
    const one = await page('p');
    const res = await uploadPhotos(u.token, Array.from({ length: 21 }, (_, i) => ({ name: `${i}.jpg`, data: one })));
    assert.equal(res.statusCode, 413, res.body);
    assert.match(JSON.parse(res.body).message, /20/);
  });

  it('/billing/limits сообщает интерфейсу, доступны ли фото', async () => {
    const free = await makeUser('Free');
    const paid = await makeUser('Standard');
    const f = JSON.parse((await app.inject({ method: 'GET', url: '/api/billing/limits', headers: auth(free.token) })).body);
    const p = JSON.parse((await app.inject({ method: 'GET', url: '/api/billing/limits', headers: auth(paid.token) })).body);
    assert.equal(f.features.scans, false);
    assert.equal(p.features.scans, true);
  });
});

describe('распознавание текста скана', () => {
  it('один запуск на загрузку; после сбоя — пауза, а не новый счёт на каждый вопрос', async () => {
    const u = await makeUser('Standard');
    const up = JSON.parse((await uploadPhotos(u.token, [{ name: 'a.jpg', data: await page('x') }])).body);
    assert.equal(await startScanOcr(db, up.id), true, 'первый запуск занимает распознавание');
    assert.equal(await startScanOcr(db, up.id), false, 'второй, пока идёт первый, ничего не запускает');
    // Ключа Anthropic в тесте нет — распознавание падает и помечается failed.
    let status: string | null = 'pending';
    for (let i = 0; i < 50 && status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = (await db.query<{ ocr_status: string }>('SELECT ocr_status FROM uploads WHERE id = $1', [up.id])).rows[0].ocr_status;
    }
    assert.equal(status, 'failed');
    assert.equal(await startScanOcr(db, up.id), false, 'сразу после сбоя повтора нет');
  });

  it('загрузка с текстом из файла не распознаётся', async () => {
    const u = await makeUser('Standard');
    await db.query(
      `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
       VALUES ('up_textpdf', $1, 'text.pdf', 10, 'application/pdf', 'local', 'k_textpdf', NULL, $2)`,
      [u.id, await encText(db, u.id, 'Обычный текст договора из файла')],
    );
    assert.equal(await startScanOcr(db, 'up_textpdf'), false);
  });

  it('распознанный текст: в чате — с предупреждением, в экспорт файла — нет', async () => {
    const u = await makeUser('Standard');
    const up = JSON.parse((await uploadPhotos(u.token, [{ name: 'a.jpg', data: await page('x') }], 'Скан аренды.pdf')).body);
    // Как при живом запуске: распознавание уже идёт, когда анализ отвечает.
    await db.query(`UPDATE uploads SET ocr_status = 'pending', ocr_started_at = now() WHERE id = $1`, [up.id]);
    const an = await app.inject({
      method: 'POST',
      url: '/api/analysis',
      headers: auth(u.token),
      payload: { fileName: up.fileName, fileSize: up.fileSize, uploadId: up.id },
    });
    assert.equal(an.statusCode, 201, an.body);
    const analysis = JSON.parse(an.body);
    assert.equal(analysis.scanOcr, 'pending', 'ответ анализа сразу помечает скан');

    const recognized = 'Пункт 9.4. Арендатор уплачивает неустойку 0,5% за каждый день просрочки.';
    await db.query(`UPDATE uploads SET extracted_text = $2, ocr_status = 'done' WHERE id = $1`, [up.id, await encText(db, u.id, recognized)]);

    const ctx = await buildAnalysisContext(db, u.id, analysis.id);
    assert.ok(ctx?.includes(recognized), 'чат видит полный распознанный текст');
    assert.match(ctx ?? '', /recognized by AI from a scanned or photographed document/);

    const again = JSON.parse((await app.inject({ method: 'GET', url: `/api/analysis/${analysis.id}`, headers: auth(u.token) })).body);
    assert.equal(again.scanOcr, 'done');

    const exp = await app.inject({
      method: 'POST',
      url: `/api/documents/${analysis.documentId}/export`,
      headers: auth(u.token),
      payload: { format: 'docx', mode: 'clean' },
    });
    assert.equal(exp.statusCode, 200, exp.body);
    const bytes = Buffer.from(exp.rawPayload);
    let xml = '';
    for (let off = 0; off < bytes.length - 4; ) {
      if (bytes.readUInt32LE(off) !== 0x04034b50) break;
      const nameLen = bytes.readUInt16LE(off + 26);
      const extraLen = bytes.readUInt16LE(off + 28);
      const compSize = bytes.readUInt32LE(off + 18);
      const name = bytes.subarray(off + 30, off + 30 + nameLen).toString();
      const data = bytes.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + compSize);
      if (name === 'word/document.xml') {
        xml = inflateRawSync(data).toString('utf8');
        break;
      }
      off += 30 + nameLen + extraLen + compSize;
    }
    assert.ok(xml.length > 0, 'document.xml найден');
    assert.ok(!xml.includes('неустойку 0,5%'), 'текст, распознанный ИИ, не уезжает в экспорт файлом');
  });
});
