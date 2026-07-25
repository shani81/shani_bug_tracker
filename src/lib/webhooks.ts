import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { checkOutboundUrl } from "@/lib/url-safety";

// ─────────────────────────────────────────────────────────────────────────────
// Outbound webhooks.
//
// Delivery is fire-and-forget: a slow or broken receiver must never make the
// user's request hang or fail, so dispatch never propagates errors and every
// attempt is recorded for later inspection.
// ─────────────────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  "issue.created",
  "issue.updated",
  "status.changed",
  "comment.created",
  "issue.deleted",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const TIMEOUT_MS = 5_000;
const MAX_BODY_LOG = 4_000;
/** Consecutive failures before a hook is disabled automatically. */
const FAILURE_LIMIT = 15;

export function generateSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}

/**
 * `sha256=<hex>` over `<timestamp>.<body>`.
 *
 * The timestamp is inside the signed material so a captured request cannot be
 * replayed later against a receiver that enforces a freshness window.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Constant-time verification — exported so receivers (and tests) can reuse it. */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  // A receiver with a missing header would otherwise get a TypeError from
  // Buffer.from rather than a clean `false`.
  if (typeof signature !== "string" || typeof timestamp !== "string") return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

type DispatchInput = {
  orgId: string;
  projectId?: string | null;
  event: WebhookEvent;
  data: Record<string, unknown>;
};

/**
 * Deliver an event to every matching hook.
 *
 * Callers should NOT await this — it is deliberately detached so a webhook
 * receiver cannot slow down or break the action that triggered it.
 */
export async function dispatchWebhooks({ orgId, projectId, event, data }: DispatchInput): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({
      where: {
        orgId,
        isEnabled: true,
        // a hook is either project-specific or org-wide
        OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])],
      },
    });

    const subscribed = hooks.filter((h) => h.events.split(",").map((e) => e.trim()).includes(event));
    if (subscribed.length === 0) return;

    const timestamp = String(Date.now());
    const body = JSON.stringify({ event, timestamp: Number(timestamp), data });

    await Promise.allSettled(subscribed.map((h) => deliver(h, event, body, timestamp)));
  } catch {
    // never surface webhook problems to the triggering request
  }
}

async function deliver(
  hook: { id: string; url: string; secret: string; failureCount: number },
  event: string,
  body: string,
  timestamp: string,
) {
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;

  // Re-validate on EVERY delivery, not just at creation. Otherwise an admin
  // could register a public hostname, pass the check once, then repoint its
  // DNS at an internal address and use the app as a persistent proxy.
  const checked = await checkOutboundUrl(hook.url);
  if (!checked.ok) {
    await recordAttempt(hook, event, body, null, `Blocked: ${checked.error}`, Date.now() - started);
    return;
  }

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BugTracker-Webhook/1",
        "X-BugTracker-Event": event,
        "X-BugTracker-Timestamp": timestamp,
        "X-BugTracker-Signature": signPayload(hook.secret, timestamp, body),
        "X-BugTracker-Delivery": randomBytes(8).toString("hex"),
      },
      body,
      // Do NOT follow redirects: the URL was validated, but a 302 to
      // 169.254.169.254 would send this signed request to an address the
      // SSRF guard exists to keep us away from.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    statusCode = res.status;
    if (res.status >= 300 && res.status < 400) {
      error = "Receiver redirected; redirects are not followed.";
    } else if (!res.ok) {
      error = `Receiver responded ${res.status}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "Request failed";
  }

  await recordAttempt(hook, event, body, statusCode, error, Date.now() - started);
}

async function recordAttempt(
  hook: { id: string; failureCount: number },
  event: string,
  body: string,
  statusCode: number | null,
  error: string | null,
  durationMs: number,
) {
  const failed = Boolean(error);

  await Promise.allSettled([
    prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event,
        payload: body.slice(0, MAX_BODY_LOG),
        statusCode,
        error,
        durationMs,
      },
    }),
    prisma.webhook.update({
      where: { id: hook.id },
      data: {
        lastStatus: statusCode,
        lastError: error,
        lastFiredAt: new Date(),
        // `increment` rather than a computed value: concurrent deliveries
        // reading the same snapshot would otherwise lose updates and keep the
        // counter permanently below the auto-disable threshold.
        failureCount: failed ? { increment: 1 } : { set: 0 },
      },
    }),
  ]);

  if (failed) {
    // Disable only once the persisted counter actually crosses the limit.
    const fresh = await prisma.webhook.findUnique({
      where: { id: hook.id },
      select: { failureCount: true },
    });
    if (fresh && fresh.failureCount >= FAILURE_LIMIT) {
      await prisma.webhook.update({ where: { id: hook.id }, data: { isEnabled: false } }).catch(() => {});
    }
  }

  // The dispatch path must prune too, or the log grows forever.
  await pruneDeliveries(hook.id).catch(() => {});
}

/** Trim the delivery log so it cannot grow without bound. */
export async function pruneDeliveries(webhookId: string, keep = 50) {
  const old = await prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    skip: keep,
    select: { id: true },
  });
  if (old.length > 0) {
    await prisma.webhookDelivery.deleteMany({ where: { id: { in: old.map((d) => d.id) } } });
  }
}
