import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-window rate limiter for the public API, keyed by token id.
//
// Deliberately a plain server-only module (never a "use server" export) so it
// cannot be reached or reset over HTTP. Single-instance only — swap for Redis
// when running more than one process.
// ─────────────────────────────────────────────────────────────────────────────

type Window = { count: number; resetAt: number };

const globalForLimit = globalThis as unknown as { __apiWindows?: Map<string, Window> };
const windows: Map<string, Window> = (globalForLimit.__apiWindows ??= new Map());

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 300; // per token per minute
const MAX_KEYS = 10_000;

/** Returns false when the caller has exhausted its window. */
export function allowApiRequest(tokenId: string): boolean {
  const now = Date.now();

  if (windows.size > MAX_KEYS) {
    for (const [k, w] of windows) if (w.resetAt < now) windows.delete(k);
  }

  const w = windows.get(tokenId);
  if (!w || w.resetAt < now) {
    windows.set(tokenId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  w.count++;
  return w.count <= MAX_REQUESTS;
}
