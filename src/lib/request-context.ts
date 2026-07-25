import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Request-scoped context.
//
// React's cache() is scoped to a render pass and does NOT give route handlers a
// shared store, so AsyncLocalStorage is what actually propagates state through
// the async call tree of one request.
// ─────────────────────────────────────────────────────────────────────────────

type RequestContext = { isApiRequest: boolean };

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` marked as an API request, so Bearer authentication is permitted. */
export function runAsApiRequest<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ isApiRequest: true }, fn);
}

/**
 * Whether the current request may authenticate with a Bearer token.
 * Defaults to false: anything that hasn't opted in is cookie-only.
 */
export function isApiRequest(): boolean {
  return storage.getStore()?.isApiRequest ?? false;
}
