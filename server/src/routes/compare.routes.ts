/**
 * POST /compare — AI diff of two contract versions.
 *
 * Accepts multipart with two files (`fileA`, `fileB`). Extracts text from each
 * (txt/docx/pdf text layer) and asks the LLM for a structured clause-by-clause
 * diff with a legal assessment of every change. Falls back to a canned diff
 * when no LLM is configured.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest } from '../lib/errors.ts';
import { assertAiAllowance, assertFeature, bumpUsage } from '../lib/limits.ts';
import { generateCompare, type CompareResult } from '../llm.ts';

const RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function compareRoutes(app: FastifyInstance, db: Db): void {
  app.post('/compare', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req): Promise<CompareResult & { fileA: string; fileB: string }> => {
    await assertFeature(db, req.currentUser.id, 'compare');
    await assertAiAllowance(db, req.currentUser.id);
    if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with "fileA" and "fileB"');

    const files: { field: string; name: string; text: string | null }[] = [];
    for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } })) {
      if (part.type !== 'file') continue;
      const name = part.filename || part.fieldname;
      if (!ALLOWED_EXTENSIONS.includes(fileExtension(name))) {
        throw badRequest(`Unsupported file type "${name}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
      }
      const buffer = await part.toBuffer();
      files.push({ field: part.fieldname, name, text: await extractText(buffer, name) });
    }

    const a = files.find((f) => f.field === 'fileA') ?? files[0];
    const b = files.find((f) => f.field === 'fileB') ?? files[1];
    if (!a || !b) throw badRequest('Attach both versions: "fileA" (older) and "fileB" (newer)');
    if (!a.text || !b.text) {
      throw badRequest(
        'Не удалось прочитать текст из одного из файлов. Для сравнения подходят DOCX, TXT и цифровые PDF (не сканы).',
      );
    }

    await bumpUsage(db, req.currentUser.id, { ai: 1 });
    const result = await generateCompare(a.text, b.text, a.name, b.name);
    return { ...result, fileA: a.name, fileB: b.name };
  });
}
