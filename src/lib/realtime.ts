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
  /** owning organization — subscribers only receive events from their own org */
  orgId?: string;
  /** free-form payload for optimistic client updates */
  data?: unknown;
  at: number;
};

type Listener = (event: RealtimeEvent) => void;
type Entry = { listener: Listener; orgId: string };

const globalForBus = globalThis as unknown as {
  __rtEntries?: Set<Entry>;
};

const entries: Set<Entry> = (globalForBus.__rtEntries ??= new Set());

/** Subscribe on behalf of one organization. Events from other orgs are dropped. */
export function subscribe(orgId: string, listener: Listener): () => void {
  const entry: Entry = { listener, orgId };
  entries.add(entry);
  return () => entries.delete(entry);
}

export function emit(event: Omit<RealtimeEvent, "at">): void {
  const full: RealtimeEvent = { ...event, at: Date.now() };
  for (const e of entries) {
    // an event without an orgId (e.g. ping) is broadcast; anything tenant-owned
    // reaches only subscribers of that same tenant
    if (full.orgId && full.orgId !== e.orgId) continue;
    try {
      e.listener(full);
    } catch {
      // a broken listener must not break the emitter
    }
  }
}
