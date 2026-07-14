/**
 * Dense embeddings via Voyage AI (voyage-law-2 — legal-domain model, 1024-dim,
 * matches the vector(1024) column). Without VOYAGE_API_KEY the corpus works in
 * FTS-only mode and `npm run rag:embed` backfills vectors later.
 */
import { config } from '../config.ts';

export const EMBEDDING_MODEL = 'voyage-law-2';
export const EMBEDDING_DIM = 1024;

export function embeddingsEnabled(): boolean {
  return Boolean(config.voyageApiKey);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed texts in small batches. The free Voyage tier allows ~3 requests/min
 * and ~10K tokens/request, so batches are small and 429s wait patiently.
 *
 * 'query' embeddings run in the LIVE request path (analysis/chat): a hung or
 * rate-limited Voyage call must never block the reply, so they get a single
 * attempt with a hard timeout — on failure the caller falls back to FTS-only
 * search. EMBED_QUERY_MAX_RETRIES (default 0) opts into 429 backoff for the
 * eval harness, whose back-to-back queries otherwise exhaust the free-tier
 * RPM (same reasoning as RERANK_MAX_RETRIES below). 'document' embeddings run
 * in offline ingest (rag:embed), where patient backoff is correct.
 */
const EMBED_QUERY_MAX_RETRIES = Math.max(0, Number(process.env.EMBED_QUERY_MAX_RETRIES ?? 0));
const EMBED_QUERY_TIMEOUT_MS = 4000;

export async function embedTexts(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  if (!embeddingsEnabled()) throw new Error('VOYAGE_API_KEY is not set');
  const live = inputType === 'query';
  const maxAttempts = live ? 1 + EMBED_QUERY_MAX_RETRIES : 8;
  const BATCH = 12;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.voyageApiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch, input_type: inputType }),
          ...(live ? { signal: AbortSignal.timeout(EMBED_QUERY_TIMEOUT_MS) } : {}),
        });
        if (res.status === 429) throw new Error('HTTP 429');
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)} (permanent)`);
        const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
        const sorted = [...data.data].sort((a, b) => a.index - b.index);
        for (const row of sorted) {
          if (row.embedding.length !== EMBEDDING_DIM) {
            throw new Error(`unexpected embedding dim ${row.embedding.length} (expected ${EMBEDDING_DIM}) (permanent)`);
          }
          out.push(row.embedding);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err as Error;
        if (lastErr.message.includes('permanent')) break;
        // No pointless sleep after the final failed attempt.
        if (attempt < maxAttempts) await sleep(lastErr.message.includes('429') ? 22_000 : 3000 * attempt);
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

/** pgvector literal: '[0.1,0.2,…]'. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export const RERANK_MODEL = 'rerank-2.5-lite';

/**
 * Cross-encoder rerank via Voyage. Returns indices of `documents` in relevance
 * order, or null on ANY failure (no key, 429, timeout, bad payload) — callers
 * must keep their original order then.
 *
 * By default this is a single attempt with a hard timeout: it runs in the live
 * request path of analyses and chat, where a slow reranker must never block a
 * reply. RERANK_MAX_RETRIES (default 0) opts into 429 backoff — used by the
 * eval harness, whose back-to-back queries otherwise exhaust the Voyage
 * free-tier rerank RPM and the metric then reflects RRF, not the real pipeline.
 */
const RERANK_MAX_RETRIES = Math.max(0, Number(process.env.RERANK_MAX_RETRIES ?? 0));

export async function rerankTexts(query: string, documents: string[], timeoutMs = 4000): Promise<number[] | null> {
  if (!embeddingsEnabled() || documents.length < 2) return null;
  for (let attempt = 0; attempt <= RERANK_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.voyageai.com/v1/rerank', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.voyageApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: RERANK_MODEL, query: query.slice(0, 1500), documents }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 && attempt < RERANK_MAX_RETRIES) throw new Error('HTTP 429 (retryable)');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { data?: { index: number; relevance_score: number }[] };
      if (!Array.isArray(data.data) || data.data.length !== documents.length) return null;
      return [...data.data].sort((a, b) => b.relevance_score - a.relevance_score).map((r) => r.index);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('retryable')) {
        await sleep(22_000); // Voyage free tier ~3 rerank req/min
        continue;
      }
      console.warn(`[rag] rerank skipped: ${msg}`);
      return null;
    }
  }
  return null;
}
