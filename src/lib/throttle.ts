import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// In-process attempt throttle for credential endpoints.
//
// This deliberately lives in a plain server-only module, NOT in a "use server"
// file: every export of a "use server" module is a public HTTP endpoint, so
// exporting these would let anyone clear the login rate limiter (unlimited
// brute force) or record failures against someone else's account (lockout).
//
// Single-instance only — swap for Redis when running more than one process.
// ─────────────────────────────────────────────────────────────────────────────

type Attempt = { count: number; first: number };

const globalForThrottle = globalThis as unknown as { __loginAttempts?: Map<string, Attempt> };
const attempts: Map<string, Attempt> = (globalForThrottle.__loginAttempts ??= new Map());

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const MAX_KEYS = 10_000;

/** `max` lets non-credential callers (e.g. bulk import) use their own budget. */
export function isThrottled(key: string, max: number = MAX_ATTEMPTS): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= max;
}

export function recordFailure(key: string): void {
  // Bounded sweep so rotating keys cannot grow the map without limit.
  if (attempts.size > MAX_KEYS) {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of attempts) if (v.first < cutoff) attempts.delete(k);
  }
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

export function clearThrottle(key: string): void {
  attempts.delete(key);
}
