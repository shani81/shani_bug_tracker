"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission, AuthError } from "@/lib/permissions";
import { generateSecret, signPayload, WEBHOOK_EVENTS, pruneDeliveries } from "@/lib/webhooks";
import { checkOutboundUrl } from "@/lib/url-safety";

// Webhooks let the server make requests to a user-chosen URL, so they are an
// admin capability (automation:manage) and every URL goes through the SSRF
// guard before it is stored or called.

const MAX_HOOKS_PER_ORG = 25;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  url: z.string().trim().min(1, "URL is required").max(2000),
  projectId: z.string().max(64).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
});

export type CreateWebhookResult =
  | { ok: true; id: string; secret: string }
  | { ok: false; error: string };

export async function createWebhook(input: {
  name: string;
  url: string;
  projectId?: string | null;
  events: string[];
}): Promise<CreateWebhookResult> {
  const ctx = await requirePermission("automation:manage");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const checked = await checkOutboundUrl(parsed.data.url);
  if (!checked.ok) return { ok: false, error: checked.error };

  // a project-scoped hook must target a project in the caller's org
  let projectId: string | null = null;
  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!project) return { ok: false, error: "Project not found." };
    projectId = project.id;
  }

  const count = await prisma.webhook.count({ where: { orgId: ctx.orgId } });
  if (count >= MAX_HOOKS_PER_ORG) {
    return { ok: false, error: "This workspace already has the maximum number of webhooks." };
  }

  const secret = generateSecret();
  const hook = await prisma.webhook.create({
    data: {
      orgId: ctx.orgId,
      projectId,
      name: parsed.data.name,
      url: checked.url,
      secret,
      events: parsed.data.events.join(","),
      createdById: ctx.userId,
    },
  });

  revalidatePath("/settings");
  // returned once — the receiver needs it to verify signatures
  return { ok: true, id: hook.id, secret };
}

const idSchema = z.string().min(1).max(64);

export async function deleteWebhook(webhookId: string) {
  const ctx = await requirePermission("automation:manage");
  const id = idSchema.parse(webhookId);
  const res = await prisma.webhook.deleteMany({ where: { id, orgId: ctx.orgId } });
  if (res.count === 0) throw new AuthError("Webhook not found.", "NOT_FOUND");
  revalidatePath("/settings");
  return { ok: true };
}

export async function setWebhookEnabled(webhookId: string, isEnabled: boolean) {
  const ctx = await requirePermission("automation:manage");
  const id = idSchema.parse(webhookId);
  const enabled = z.boolean().parse(isEnabled);
  const res = await prisma.webhook.updateMany({
    where: { id, orgId: ctx.orgId },
    // re-enabling clears the failure streak that auto-disabled it
    data: { isEnabled: enabled, ...(enabled ? { failureCount: 0, lastError: null } : {}) },
  });
  if (res.count === 0) throw new AuthError("Webhook not found.", "NOT_FOUND");
  revalidatePath("/settings");
  return { ok: true };
}

export type TestResult = { ok: boolean; status?: number; error?: string; durationMs: number };

/** Send a signed ping so the receiver can be verified end to end. */
export async function testWebhook(webhookId: string): Promise<TestResult> {
  const ctx = await requirePermission("automation:manage");
  const id = idSchema.parse(webhookId);

  const hook = await prisma.webhook.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!hook) throw new AuthError("Webhook not found.", "NOT_FOUND");

  // re-validate: the URL was safe when saved, but DNS may have changed since
  const checked = await checkOutboundUrl(hook.url);
  if (!checked.ok) return { ok: false, error: checked.error, durationMs: 0 };

  const timestamp = String(Date.now());
  const body = JSON.stringify({
    event: "ping",
    timestamp: Number(timestamp),
    data: { message: "Test delivery from Bug Tracker", webhookId: hook.id },
  });

  const started = Date.now();
  let status: number | undefined;
  let error: string | undefined;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BugTracker-Webhook/1",
        "X-BugTracker-Event": "ping",
        "X-BugTracker-Timestamp": timestamp,
        "X-BugTracker-Signature": signPayload(hook.secret, timestamp, body),
      },
      body,
      // see webhooks.ts — a redirect could point back at a private address
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    status = res.status;
    if (res.status >= 300 && res.status < 400) {
      error = "Receiver redirected; redirects are not followed.";
    } else if (!res.ok) {
      error = `Receiver responded ${res.status}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "Request failed";
  }
  const durationMs = Date.now() - started;

  await prisma.webhookDelivery.create({
    data: { webhookId: hook.id, event: "ping", payload: body, statusCode: status ?? null, error: error ?? null, durationMs },
  });
  await prisma.webhook.update({
    where: { id: hook.id },
    data: { lastStatus: status ?? null, lastError: error ?? null, lastFiredAt: new Date() },
  });
  await pruneDeliveries(hook.id);

  revalidatePath("/settings");
  return { ok: !error, status, error, durationMs };
}
