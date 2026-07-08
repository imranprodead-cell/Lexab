/** Server-Sent Events helper (used by /analysis and chat replies). */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isOriginAllowed } from '../config.ts';

export function wantsSSE(req: FastifyRequest): boolean {
  return (req.headers.accept ?? '').includes('text/event-stream');
}

export interface SseChannel {
  send(event: string, data: unknown): void;
  close(): void;
}

export function openSSE(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  const origin = req.headers.origin;
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  // CORS hooks don't run on hijacked replies — mirror the policy manually.
  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  res.writeHead(200, headers);
  return {
    send(event, data) {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (!res.writableEnded) res.end();
    },
  };
}
