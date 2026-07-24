// ─────────────────────────────────────────────────────────────────────────────
// In-process pub/sub bus powering real-time sync over Server-Sent Events.
// A module-level singleton survives across requests within one server process.
// (For multi-instance prod, swap this for Redis pub/sub or a hosted channel —
// the emit()/subscribe() surface stays identical.)
// ─────────────────────────────────────────────────────────────────────────────

export type RealtimeEvent = {
  type:
    | "issue.created"
    | "issue.updated"
    | "issue.deleted"
    | "comment.created"
    | "status.changed"
    | "assignment.changed"
    | "release.updated"
    | "notification.created"
    | "ping";
  /** entity id the event concerns (issue id, etc.) */
  id?: string;
  /** free-form payload for optimistic client updates */
  data?: unknown;
  at: number;
};

type Listener = (event: RealtimeEvent) => void;

const globalForBus = globalThis as unknown as {
  __rtListeners?: Set<Listener>;
};

const listeners: Set<Listener> = (globalForBus.__rtListeners ??= new Set());

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: Omit<RealtimeEvent, "at">): void {
  const full: RealtimeEvent = { ...event, at: Date.now() };
  for (const l of listeners) {
    try {
      l(full);
    } catch {
      // a broken listener must not break the emitter
    }
  }
}
