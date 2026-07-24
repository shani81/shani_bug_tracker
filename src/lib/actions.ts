"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { emit } from "@/lib/realtime";
import { formatKey } from "@/lib/utils";

function revalidateAll() {
  for (const p of ["/", "/bugs", "/features", "/improvements", "/tasks", "/analytics", "/notifications"]) {
    revalidatePath(p);
  }
}

// ── Create issue ─────────────────────────────────────────────────────────────

const createIssueSchema = z.object({
  projectId: z.string().min(1),
  type: z.string().default("bug"),
  title: z.string().min(1, "Title is required").max(300),
  descMd: z.string().default(""),
  expected: z.string().default(""),
  actual: z.string().default(""),
  steps: z.string().default(""),
  url: z.string().default(""),
  priority: z.string().default("medium"),
  severity: z.string().default("major"),
  impact: z.string().default("moderate"),
  environment: z.string().default("production"),
  browser: z.string().default(""),
  os: z.string().default(""),
  device: z.string().default(""),
  appVersion: z.string().default(""),
  contextJson: z.string().default(""),
  statusId: z.string().optional(),
  componentId: z.string().optional().nullable(),
  releaseId: z.string().optional().nullable(),
  sprintId: z.string().optional().nullable(),
  storyPoints: z.number().int().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  assigneeIds: z.array(z.string()).default([]),
  labelIds: z.array(z.string()).default([]),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        kind: z.string().default("file"),
        url: z.string().default(""),
        sizeBytes: z.number().default(0),
        mimeType: z.string().default(""),
      }),
    )
    .default([]),
});

export type CreateIssueInput = z.input<typeof createIssueSchema>;

export async function createIssue(input: CreateIssueInput) {
  const data = createIssueSchema.parse(input);
  const user = await getCurrentUser();
  if (!user) throw new Error("No current user");

  const project = await prisma.project.findUnique({ where: { id: data.projectId } });
  if (!project) throw new Error("Project not found");

  // resolve default status if none given
  let statusId = data.statusId;
  if (!statusId) {
    const def =
      (await prisma.workflowStatus.findFirst({ where: { projectId: project.id, isDefault: true } })) ??
      (await prisma.workflowStatus.findFirst({ where: { projectId: project.id }, orderBy: { order: "asc" } }));
    if (!def) throw new Error("Project has no statuses");
    statusId = def.id;
  }

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
        reporterId: user.id,
        componentId: data.componentId ?? undefined,
        releaseId: data.releaseId ?? undefined,
        sprintId: data.sprintId ?? undefined,
        storyPoints: data.storyPoints ?? undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        boardOrder: Date.now(),
        assignees: { create: data.assigneeIds.map((userId) => ({ userId })) },
        labels: { create: data.labelIds.map((labelId) => ({ labelId })) },
        watchers: { create: [{ userId: user.id }] },
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

  await logActivity({ issueId: issue.id, actorId: user.id, verb: "created" });

  // notify assignees
  for (const userId of data.assigneeIds) {
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

  emit({ type: "issue.created", id: issue.id, data: { key: issue.key } });
  revalidateAll();
  return { id: issue.id, key: issue.key };
}

// ── Update issue fields ──────────────────────────────────────────────────────

const updatableFields = [
  "type",
  "title",
  "descMd",
  "expected",
  "actual",
  "steps",
  "url",
  "priority",
  "severity",
  "impact",
  "environment",
  "componentId",
  "releaseId",
  "sprintId",
  "storyPoints",
] as const;

export async function updateIssue(id: string, patch: Record<string, unknown>) {
  const user = await getCurrentUser();
  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) throw new Error("Issue not found");

  const data: Record<string, unknown> = {};
  for (const key of updatableFields) {
    if (key in patch) data[key] = patch[key];
  }
  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.issue.update({ where: { id }, data });

  for (const key of Object.keys(data)) {
    await logActivity({
      issueId: id,
      actorId: user?.id,
      verb: "updated",
      field: key,
      fromVal: String((existing as Record<string, unknown>)[key] ?? ""),
      toVal: String(data[key] ?? ""),
    });
  }

  emit({ type: "issue.updated", id });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Change status (list dropdown or kanban drag) ─────────────────────────────

export async function changeStatus(id: string, statusId: string, boardOrder?: number) {
  const user = await getCurrentUser();
  const existing = await prisma.issue.findUnique({ where: { id }, include: { status: true } });
  if (!existing) throw new Error("Issue not found");

  const nextStatus = await prisma.workflowStatus.findUnique({ where: { id: statusId } });
  if (!nextStatus) throw new Error("Status not found");

  const isDone = nextStatus.category === "done";
  const wasDone = existing.status.category === "done";

  await prisma.issue.update({
    where: { id },
    data: {
      statusId,
      boardOrder: boardOrder ?? existing.boardOrder,
      resolvedAt: isDone && !wasDone ? new Date() : wasDone && !isDone ? null : existing.resolvedAt,
      closedAt: isDone ? new Date() : null,
    },
  });

  await logActivity({
    issueId: id,
    actorId: user?.id,
    verb: "status_changed",
    field: "status",
    fromVal: existing.status.name,
    toVal: nextStatus.name,
  });

  emit({ type: "status.changed", id, data: { statusId } });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Assignment ───────────────────────────────────────────────────────────────

export async function setAssignees(id: string, userIds: string[]) {
  const user = await getCurrentUser();
  await prisma.$transaction([
    prisma.issueAssignee.deleteMany({ where: { issueId: id } }),
    prisma.issueAssignee.createMany({ data: userIds.map((userId) => ({ issueId: id, userId })) }),
  ]);
  await logActivity({ issueId: id, actorId: user?.id, verb: "assigned", field: "assignees" });
  emit({ type: "assignment.changed", id });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Labels ───────────────────────────────────────────────────────────────────

export async function setLabels(id: string, labelIds: string[]) {
  await prisma.$transaction([
    prisma.issueLabel.deleteMany({ where: { issueId: id } }),
    prisma.issueLabel.createMany({ data: labelIds.map((labelId) => ({ issueId: id, labelId })) }),
  ]);
  emit({ type: "issue.updated", id });
  revalidateAll();
  revalidatePath(`/issue/${id}`);
  return { ok: true };
}

// ── Comments ─────────────────────────────────────────────────────────────────

export async function addComment(issueId: string, bodyMd: string, parentId?: string, isPrivate = false) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No current user");
  if (!bodyMd.trim()) throw new Error("Comment cannot be empty");

  const comment = await prisma.comment.create({
    data: { issueId, authorId: user.id, bodyMd, parentId: parentId ?? undefined, isPrivate },
  });
  await logActivity({ issueId, actorId: user.id, verb: "commented" });
  emit({ type: "comment.created", id: issueId, data: { commentId: comment.id } });
  revalidatePath(`/issue/${issueId}`);
  return { id: comment.id };
}

// ── Watch / time / soft-delete ───────────────────────────────────────────────

export async function toggleWatch(issueId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No current user");
  const existing = await prisma.watcher.findUnique({
    where: { issueId_userId: { issueId, userId: user.id } },
  });
  if (existing) {
    await prisma.watcher.delete({ where: { id: existing.id } });
  } else {
    await prisma.watcher.create({ data: { issueId, userId: user.id } });
  }
  revalidatePath(`/issue/${issueId}`);
  return { watching: !existing };
}

export async function logTime(issueId: string, minutes: number, note = "") {
  const user = await getCurrentUser();
  if (!user) throw new Error("No current user");
  await prisma.timeLog.create({ data: { issueId, userId: user.id, minutes, note } });
  await logActivity({ issueId, actorId: user.id, verb: "logged_time", toVal: String(minutes) });
  revalidatePath(`/issue/${issueId}`);
  return { ok: true };
}

export async function softDeleteIssue(id: string) {
  const user = await getCurrentUser();
  await prisma.issue.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity({ issueId: id, actorId: user?.id, verb: "deleted" });
  emit({ type: "issue.deleted", id });
  revalidateAll();
  return { ok: true };
}

export async function markNotificationRead(id: string) {
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) return { ok: true };
  await prisma.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
  revalidatePath("/notifications");
  return { ok: true };
}

// ── QA: record a test result on a plan's latest run ──────────────────────────

export async function setTestResultStatus(planId: string, caseId: string, status: string) {
  let run = await prisma.testRun.findFirst({ where: { planId }, orderBy: { startedAt: "desc" } });
  if (!run) run = await prisma.testRun.create({ data: { planId, name: "Ad-hoc run" } });
  await prisma.testResult.create({ data: { runId: run.id, caseId, status } });
  revalidatePath("/qa");
  return { ok: true };
}

// ── Settings: toggle an automation rule ──────────────────────────────────────

export async function toggleAutomation(id: string) {
  const a = await prisma.automationRule.findUnique({ where: { id } });
  if (!a) return { ok: false };
  await prisma.automationRule.update({ where: { id }, data: { isEnabled: !a.isEnabled } });
  revalidatePath("/settings");
  return { ok: true };
}

// ── Releases / sprints: quick create ─────────────────────────────────────────

export async function createRelease(projectId: string, version: string, name: string) {
  await prisma.release.create({ data: { projectId, version, name } });
  revalidatePath("/releases");
  revalidatePath("/roadmap");
  return { ok: true };
}

export async function createSprint(projectId: string, name: string, goal: string) {
  await prisma.sprint.create({ data: { projectId, name, goal } });
  revalidatePath("/sprints");
  return { ok: true };
}
