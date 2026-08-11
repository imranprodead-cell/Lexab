/**
 * Разбор ключа сервисного аккаунта Google (озвучка).
 *
 * Тест написан по живой поломке 2026-08-11: после переезда на Railway озвучка
 * замолчала, а в логах было только «DECODER routines::unsupported». Причина —
 * панель хостинга удвоила обратные слэши в переносах PEM. Проверяем не текст
 * ошибки, а то, что ключ после разбора реально годится для подписи.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseServiceAccount } from '../src/lib/googleAuth.ts';

/** Настоящая пара ключей — подпись должна пройти, а не «примерно совпасть». */
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function sign(pem: string): void {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update('header.claims');
  signer.sign(pem);
}

test('ключ с удвоенными переносами (как его портит панель хостинга) чинится и подписывает', () => {
  // Именно то, что доехало до сервера: в JSON вместо \n лежит \\n.
  const broken = JSON.stringify({
    client_email: 'tts@example.iam.gserviceaccount.com',
    private_key: privateKey.replace(/\n/g, '\\n'),
    project_id: 'lexab',
  });

  // Убеждаемся, что без починки это действительно не работает — иначе тест
  // ничего не доказывает.
  const raw = JSON.parse(broken) as { private_key: string };
  assert.throws(() => sign(raw.private_key));

  const sa = parseServiceAccount(broken);
  assert.doesNotThrow(() => sign(sa.private_key));
  assert.equal(sa.client_email, 'tts@example.iam.gserviceaccount.com');
  assert.equal(sa.project_id, 'lexab');
});

test('нормальный ключ проходит без изменений', () => {
  const good = JSON.stringify({
    client_email: 'tts@example.iam.gserviceaccount.com',
    private_key: privateKey,
    project_id: 'lexab',
  });
  const sa = parseServiceAccount(good);
  assert.equal(sa.private_key, privateKey);
  assert.doesNotThrow(() => sign(sa.private_key));
});

test('не-JSON и чужой JSON отвергаются понятным сообщением', () => {
  assert.throws(() => parseServiceAccount('AIzaSyНеКлюч'), /не JSON/);
  assert.throws(() => parseServiceAccount('{"foo":1}'), /client_email/);
});
