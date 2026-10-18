import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_ACCEPT, DOC_EXTENSIONS, isDocFile, MAX_DOC_BYTES } from './docFormats';

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
});
