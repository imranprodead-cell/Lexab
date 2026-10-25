import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTACH_EXTENSIONS, DOC_ACCEPT, DOC_EXTENSIONS, isAttachFile, isDocFile, MAX_DOC_BYTES, maxAttachments } from './docFormats';

describe('форматы договора — один список с сервером', () => {
  it('совпадает с ALLOWED_EXTENSIONS и MAX_UPLOAD_BYTES сервера', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../server/src/extract.ts'), 'utf8');
    const list = /ALLOWED_EXTENSIONS\s*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
    const server = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...DOC_EXTENSIONS].sort()).toEqual(server.sort());
    expect(src).toMatch(/MAX_UPLOAD_BYTES\s*=\s*10 \* 1024 \* 1024/);
    expect(MAX_DOC_BYTES).toBe(10 * 1024 * 1024);
  });

  it('.md и .doc принимаются везде, где принимается договор', () => {
    expect(isDocFile('Условия.MD')).toBe(true);
    expect(isDocFile('старый.doc')).toBe(true);
    expect(isDocFile('скан.jpg')).toBe(false);
    expect(DOC_ACCEPT).toBe('.pdf,.doc,.docx,.txt,.md');
  });

  it('вложения чата — тот же список, что ATTACHMENT_EXTENSIONS сервера; лимит как на сервере', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../server/src/extract.ts'), 'utf8');
    const extra = /ATTACHMENT_EXTENSIONS\s*=\s*\[\.\.\.ALLOWED_EXTENSIONS,([^\]]*)\]/.exec(src)?.[1] ?? '';
    const server = [...DOC_EXTENSIONS, ...[...extra.matchAll(/'([^']+)'/g)].map((m) => m[1])];
    expect([...ATTACH_EXTENSIONS].sort()).toEqual(server.sort());
    expect(isAttachFile('Сроки.XLSX')).toBe(true);
    expect(isAttachFile('Сроки.xlsx') && !isDocFile('Сроки.xlsx')).toBe(true);
    expect(isAttachFile('старый.xls')).toBe(false);
    const limits = fs.readFileSync(path.resolve(__dirname, '../../server/src/lib/chatAttachments.ts'), 'utf8');
    expect(limits).toMatch(/plan === 'Free' \? 2 : 5/);
    expect([maxAttachments('Free'), maxAttachments(undefined), maxAttachments('Pro'), maxAttachments('Business')]).toEqual([2, 2, 5, 5]);
  });
});
