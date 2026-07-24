"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { emit } from "@/lib/realtime";
import { formatKey } from "@/lib/utils";
import {
  requireAuth,
  requirePermission,
  requireIssueAccess,
  AuthError,
} from "@/lib/permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Every mutation below is guarded twice:
//   1. capability  — does this role may perform the operation at all?
//   2. ownership   — does the target row belong to the caller's organization?
// requireIssueAccess()/requirePermission() throw AuthError on failure, which
// surfaces to the client as a rejected server action.
// ─────────────────────────────────────────────────────────────────────────────

function revalidateAll() {
  for (const p of ["/", "/bugs", "/features", "/improvements", "/tasks", "/analytics", "/notifications"]) {
    revalidatePath(p);
  }
}

// ── Create issue ─────────────────────────────────────────────────────────────

const createIssueSchema = z.object({
  projectId: z.string().min(1),
  type: z.string().default("bug"),
  title: z.string().trim().min(1, "Title is required").max(300),
  descMd: z.string().max(20_000).default(""),
  expected: z.string().max(10_000).default(""),
  actual: z.string().max(10_000).default(""),
  steps: z.string().max(10_000).default(""),
  url: z.string().max(2000).default(""),
  priority: z.string().default("medium"),
  severity: z.string().default("major"),
  impact: z.string().default("moderate"),
  environment: z.string().default("production"),
  browser: z.string().max(200).default(""),
  os: z.string().max(200).default(""),
  device: z.string().max(200).default(""),
  appVersion: z.string().max(100).default(""),
  contextJson: z.string().max(20_000).default(""),
  statusId: z.string().optional(),
  componentId: z.string().optional().nullable(),
  releaseId: z.string().optional().nullable(),
  sprintId: z.string().optional().nullable(),
  storyPoints: z.number().int().min(0).max(1000).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  assigneeIds: z.array(z.string()).max(20).default([]),
  labelIds: z.array(z.string()).max(30).default([]),
  attachments: z
    .array(
      z.object({
        name: z.string().max(300),
        kind: z.string().max(40).default("file"),
        url: z.string().default(""),
        sizeBytes: z.number().default(0),
        mimeType: z.string().max(200).default(""),
      }),
    )
    .max(10)
    .default([]),
});

export type CreateIssueInput = z.input<typeof createIssueSchema>;

export async function createIssue(input: CreateIssueInput) {
  const data = createIssueSchema.parse(input);
  // verifies the project is in the caller's org AND that they may create
  const ctx = await requirePermission("issue:create", { projectId: data.projectId });

  const project = await prisma.project.findUnique({ where: { id: data.projectId } });
  if (!project) throw new AuthError("Project not found.", "NOT_FOUND");

  // Every referenced child row must belong to this same project — otherwise a
  // caller could attach another tenant's status/label/component by id.
  let statusId = data.statusId;
  if (statusId) {
    const ok = await prisma.workflowStatus.findFirst({
      where: { id: statusId, projectId: project.id },
      select: { id: true },
    });
    if (!ok) throw new AuthError("Status not found.", "NOT_FOUND");
  } else {
    const def =
      (await prisma.workflowStatus.findFirst({ where: { projectId: project.id, isDefault: true } })) ??
      (await prisma.workflowStatus.findFirst({ where: { projectId: project.id }, orderBy: { order: "asc" } }));
    if (!def) throw new Error("Project has no statuses");
    statusId = def.id;
  }

  const labelIds = data.labelIds.length
    ? (
        await prisma.label.findMany({
          where: { id: { in: data.labelIds }, projectId: project.id },
          select: { id: true },
        })
      ).map((l) => l.id)
    : [];

  const assigneeIds = data.assigneeIds.length
    ? (
        await prisma.user.findMany({
          where: { id: { in: data.assigneeIds }, orgId: ctx.orgId },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  const componentId = data.componentId
    ? (await prisma.component.findFirst({ where: { id: data.componentId, projectId: project.id } }))?.id ?? null
    : null;
  const releaseId = data.releaseId
    ? (await prisma.release.findFirst({ where: { id: data.releaseId, projectId: project.id } }))?.id ?? null
    : null;
  const sprintId = data.sprintId
    ? (await prisma.sprint.findFirst({ where: { id: data.sprintId, projectId: project.id } }))?.id ?? null
    : null;

  const issue = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: project.id },
      data: { issueSeq: { increment: 1 } },
      select: { issueSeq: true, key: true },
    });
    const number = updated.issueSeq;
    return tx.issue.create({
      data: {
        projectId: project.id,
        number,
        key: formatKey(updated.key, number),
        type: data.type,
        title: data.title,
        descMd: data.descMd,
        expected: data.expected,
        actual: data.actual,
        steps: data.steps,
        url: data.url,
        priority: data.priority,
        severity: data.severity,
        impact: data.impact,
        environment: data.environment,
        browser: data.browser,
        os: data.os,
        device: data.device,
        appVersion: data.appVersion,
        contextJson: data.contextJson,
        statusId: statusId!,
        reporterId: ctx.userId,
        componentId: componentId ?? undefined,
        releaseId: releaseId ?? undefined,
        sprintId: sprintId ?? undefined,
        storyPoints: data.storyPoints ?? undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        boardOrder: Date.now(),
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        labels: { create: labelIds.map((labelId) => ({ labelId })) },
        watchers: { create: [{ userId: ctx.userId }] },
        attachments: {
          create: data.attachments
            .filter((a) => a.url)
            .map((a) => ({
              name: a.name,
              kind: a.kind,
              url: a.url,
              sizeBytes: a.sizeBytes,
              mimeType: a.mimeType,
            })),
        },
      },
    });
  });

  await logActivity({ issueId: issue.id, actorId: ctx.userId, verb: "created" });

  for (const userId of assigneeIds) {
    await prisma.notification.create({
      data: {
        userId,
        title: `Assigned to ${issue.key}`,
        body: issue.title,
        kind: "assigned",
        issueId: issue.id,
      },
    });
  }

  emit({ type: "issue.created", id: issue.id, orgId: ctx.orgId, data: { key: issue.key } });
  revalidateAll();
  return { id: issue.id, key: issue.key };
}

// ── Update issue fields ──────────────────────────────────────────────────────

// Allowlist + per-field validation. Anything not listed here (projectId, key,
// number, reporterId, statusId, deletedAt…) is unreachable via this action.
const updatePatchSchema = z
  .object({
    type: z.string().max(40),
    title: z.string().trim().min(1).max(300),
    descMd: z.string().max(20_000),
    expected: z.string().max(10_000),
    actual: z.string().max(10_000),
    steps: z.string().max(10_000),
    url: z.string().max(2000),
    priority: z.string().max(40),
    severity: z.string().max(40),
    impact: z.string().max(40),
    environment: z.string().max(40),
    storyPoints: z.number().int().min(0).max(1000).nullable(),
  })
  .partial();

/** Relations are validated against the issue's own project before being set. */
const relationFields = ["componentId", "releaseId", "sprintId"] as const;

export async function updateIssue(id: string, patch: Record<string, unknown>) {
  const { ctx, issue } = await requireIssueAccess(id, "issue:update");
  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) throw new AuthError("Issue not found.", "NOT_FOUND");

  const data: Record<string, unknown> = { ...updatePatchSchema.parse(patch) };

  for (const key of relationFields) {
    if (!(key in patch)) continue;
    const val = patch[key];
    if (val === null || val === "") {
      data[key] = null;
      continue;
    }
    if (typeof val !== "string") continue;
    const table =
      key === "componentId" ? prisma.component : key === "releaseId" ? prisma.release : prisma.sprint;
    // @ts-expect-error — the three delegates share this findFirst shape
    const owned = await table.findFirst({ where: { id: val, projectId: issue.projectId }, select: { id: true } });
    if (!owned) throw new AuthError("Related record not found.", "NOT_FOUND");
    data[key] = val;
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.issue.update({ where: { id }, data });

  for (const key of Object.keys(data)) {
    await logActivity({
      issueId: id,
      actorId: ctx.userId,
      verb: "updated",
      field: key,
      fromVal: String((existing as Record<string, unknown>)[key] ?? ""),
      toVal: String(data[key] ?? ""),
    });
  }

  emit({ type: "issue.updated", id, orgId: ctx.orgId });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Change status ────────────────────────────────────────────────────────────

export async function changeStatus(id: string, statusId: string, boardOrder?: number) {
  const { ctx } = await requireIssueAccess(id, "issue:transition");
  const existing = await prisma.issue.findUnique({ where: { id }, include: { status: true } });
  if (!existing) throw new AuthError("Issue not found.", "NOT_FOUND");

  // the target status must belong to this issue's own project
  const nextStatus = await prisma.workflowStatus.findFirst({
    where: { id: statusId, projectId: existing.projectId },
  });
  if (!nextStatus) throw new AuthError("Status not found.", "NOT_FOUND");

  const isDone = nextStatus.category === "done";
  const wasDone = existing.status.category === "done";

  await prisma.issue.update({
    where: { id },
    data: {
      statusId,
      boardOrder: typeof boardOrder === "number" && Number.isFinite(boardOrder) ? boardOrder : existing.boardOrder,
      resolvedAt: isDone && !wasDone ? new Date() : wasDone && !isDone ? null : existing.resolvedAt,
      closedAt: isDone ? new Date() : null,
    },
  });

  await logActivity({
    issueId: id,
    actorId: ctx.userId,
    verb: "status_changed",
    field: "status",
    fromVal: existing.status.name,
    toVal: nextStatus.name,
  });

  emit({ type: "status.changed", id, orgId: ctx.orgId, data: { statusId } });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Assignment ───────────────────────────────────────────────────────────────

export async function setAssignees(id: string, userIds: string[]) {
  const { ctx } = await requireIssueAccess(id, "issue:assign");
  // only real members of this org may be assigned
  const valid = await prisma.user.findMany({
    where: { id: { in: userIds.slice(0, 20) }, orgId: ctx.orgId },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.issueAssignee.deleteMany({ where: { issueId: id } }),
    prisma.issueAssignee.createMany({ data: valid.map((u) => ({ issueId: id, userId: u.id })) }),
  ]);
  await logActivity({ issueId: id, actorId: ctx.userId, verb: "assigned", field: "assignees" });
  emit({ type: "assignment.changed", id, orgId: ctx.orgId });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Labels ───────────────────────────────────────────────────────────────────

export async function setLabels(id: string, labelIds: string[]) {
  const { ctx, issue } = await requireIssueAccess(id, "issue:update");
  const valid = await prisma.label.findMany({
    where: { id: { in: labelIds.slice(0, 30) }, projectId: issue.projectId },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.issueLabel.deleteMany({ where: { issueId: id } }),
    prisma.issueLabel.createMany({ data: valid.map((l) => ({ issueId: id, labelId: l.id })) }),
  ]);
  emit({ type: "issue.updated", id, orgId: ctx.orgId });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function addComment(issueId: string, bodyMd: string, parentId?: string, isPrivate = false) {
  const { ctx } = await requireIssueAccess(issueId, "comment:create");
  const body = bodyMd.trim();
  if (!body) throw new Error("Comment cannot be empty");
  if (body.length > 20_000) throw new Error("Comment is too long");

  // "Internal note" is a staff-only affordance; a guest must not be able to
  // author one (they cannot read them either).
  const canBePrivate = isPrivate && ctx.orgRole !== "guest";

  // a reply's parent must live on the same issue
  let parent: string | undefined;
  if (parentId) {
    const p = await prisma.comment.findFirst({ where: { id: parentId, issueId }, select: { id: true } });
    if (!p) throw new AuthError("Parent comment not found.", "NOT_FOUND");
    parent = p.id;
  }

  const comment = await prisma.comment.create({
    data: { issueId, authorId: ctx.userId, bodyMd: body, parentId: parent, isPrivate: canBePrivate },
  });
  await logActivity({ issueId, actorId: ctx.userId, verb: "commented" });
  emit({ type: "comment.created", id: issueId, orgId: ctx.orgId, data: { commentId: comment.id } });
  revalidatePath(`/issue/${issueId}`);
  return { id: comment.id };
}

// ── Watch / time / soft-delete ───────────────────────────────────────────────

export async function toggleWatch(issueId: string) {
  // watching only needs read access to the issue
  const { ctx } = await requireIssueAccess(issueId, "comment:create");
  const existing = await prisma.watcher.findUnique({
    where: { issueId_userId: { issueId, userId: ctx.userId } },
  });
  if (existing) {
    await prisma.watcher.delete({ where: { id: existing.id } });
  } else {
    await prisma.watcher.create({ data: { issueId, userId: ctx.userId } });
  }
  revalidatePath(`/issue/${issueId}`);
  return { watching: !existing };
}

export async function logTime(issueId: string, minutes: number, note = "") {
  const { ctx } = await requireIssueAccess(issueId, "time:log");
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60 * 24 * 31) {
    throw new Error("Enter a valid number of minutes");
  }
  await prisma.timeLog.create({
    data: { issueId, userId: ctx.userId, minutes: Math.round(minutes), note: note.slice(0, 500) },
  });
  await logActivity({ issueId, actorId: ctx.userId, verb: "logged_time", toVal: String(minutes) });
  revalidatePath(`/issue/${issueId}`);
  return { ok: true };
}

export async function softDeleteIssue(id: string) {
  const { ctx } = await requireIssueAccess(id, "issue:delete");
  await prisma.issue.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity({ issueId: id, actorId: ctx.userId, verb: "deleted" });
  emit({ type: "issue.deleted", id, orgId: ctx.orgId });
  revalidateAll();
  return { ok: true };
}

// ── Notifications (always scoped to the caller) ──────────────────────────────

export async function markNotificationRead(id: string) {
  const ctx = await requireAuth();
  // updateMany with the ownership predicate: a foreign id simply matches nothing
  await prisma.notification.updateMany({ where: { id, userId: ctx.userId }, data: { isRead: true } });
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead() {
  const ctx = await requireAuth();
  await prisma.notification.updateMany({ where: { userId: ctx.userId, isRead: false }, data: { isRead: true } });
  revalidatePath("/notifications");
  return { ok: true };
}

// ── QA ───────────────────────────────────────────────────────────────────────

export async function setTestResultStatus(planId: string, caseId: string, status: string) {
  const ctx = await requireAuth();
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId, project: { orgId: ctx.orgId } },
    select: { id: true, projectId: true },
  });
  if (!plan) throw new AuthError("Test plan not found.", "NOT_FOUND");
  await requirePermission("qa:record", { projectId: plan.projectId });

  const testCase = await prisma.testCase.findFirst({
    where: { id: caseId, planId: plan.id },
    select: { id: true },
  });
  if (!testCase) throw new AuthError("Test case not found.", "NOT_FOUND");

  const allowed = ["pass", "fail", "blocked", "retest", "untested"];
  if (!allowed.includes(status)) throw new Error("Invalid test result status");

  let run = await prisma.testRun.findFirst({ where: { planId: plan.id }, orderBy: { startedAt: "desc" } });
  if (!run) run = await prisma.testRun.create({ data: { planId: plan.id, name: "Ad-hoc run", runById: ctx.userId } });
  await prisma.testResult.create({ data: { runId: run.id, caseId: testCase.id, status } });
  revalidatePath("/qa");
  return { ok: true };
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function toggleAutomation(id: string) {
  const ctx = await requireAuth();
  const rule = await prisma.automationRule.findFirst({
    where: { id, project: { orgId: ctx.orgId } },
    select: { id: true, projectId: true, isEnabled: true },
  });
  if (!rule) throw new AuthError("Automation rule not found.", "NOT_FOUND");
  await requirePermission("automation:manage", { projectId: rule.projectId });

  await prisma.automationRule.update({ where: { id: rule.id }, data: { isEnabled: !rule.isEnabled } });
  revalidatePath("/settings");
  return { ok: true };
}

// ── Releases / sprints ───────────────────────────────────────────────────────

export async function createRelease(projectId: string, version: string, name: string) {
  await requirePermission("release:manage", { projectId });
  const v = version.trim();
  if (!v) throw new Error("Version is required");
  await prisma.release.create({ data: { projectId, version: v.slice(0, 50), name: name.trim().slice(0, 200) } });
  revalidatePath("/releases");
  revalidatePath("/roadmap");
  return { ok: true };
}

export async function createSprint(projectId: string, name: string, goal: string) {
  await requirePermission("sprint:manage", { projectId });
  const n = name.trim();
  if (!n) throw new Error("Name is required");
  await prisma.sprint.create({ data: { projectId, name: n.slice(0, 200), goal: goal.trim().slice(0, 500) } });
  revalidatePath("/sprints");
  return { ok: true };
}
