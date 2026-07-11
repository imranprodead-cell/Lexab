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
import { ALLOWED_EXTENSIONS, assertValidFileContent, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest } from '../lib/errors.ts';
import { assertFeature, withAiRequest } from '../lib/limits.ts';
import { generateCompare, type CompareResult } from '../llm.ts';

const RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function compareRoutes(app: FastifyInstance, db: Db): void {
  app.post('/compare', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req): Promise<CompareResult & { fileA: string; fileB: string }> => {
    await assertFeature(db, req.currentUser.id, 'compare');
    if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with "fileA" and "fileB"');

    const files: { field: string; name: string; text: string | null }[] = [];
    for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } })) {
      if (part.type !== 'file') continue;
      const name = part.filename || part.fieldname;
      if (!ALLOWED_EXTENSIONS.includes(fileExtension(name))) {
        throw badRequest(`Unsupported file type "${name}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
      }
      const buffer = await part.toBuffer();
      assertValidFileContent(buffer, name);
      files.push({ field: part.fieldname, name, text: await extractText(buffer, name) });
    }

    const a = files.find((f) => f.field === 'fileA') ?? files[0];
    const b = files.find((f) => f.field === 'fileB') ?? files[1];
    if (!a || !b) throw badRequest('Attach both versions: "fileA" (older) and "fileB" (newer)');
    const textA = a.text;
    const textB = b.text;
    if (!textA || !textB) {
      throw badRequest(
        'Не удалось прочитать текст из одного из файлов. Для сравнения подходят DOCX, TXT и цифровые PDF (не сканы).',
      );
    }

    // Atomic reservation right before the model call: it's released if the
    // model fails, so a failed/unavailable model never consumes the allowance.
    const result = await withAiRequest(db, req.currentUser.id, (plan) =>
      generateCompare(textA, textB, a.name, b.name, plan),
    );
    return { ...result, fileA: a.name, fileB: b.name };
  });
}
