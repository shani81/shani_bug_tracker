"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission, AuthError, ValidationError } from "@/lib/permissions";
import { STATUS_CATEGORIES } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Project configuration: workflow statuses, labels, components, releases and
// sprints.
//
// Everything here requires project:manage and is scoped to the caller's org via
// requirePermission({ projectId }), which returns NOT_FOUND for another
// tenant's project rather than revealing that it exists.
// ─────────────────────────────────────────────────────────────────────────────

const idSchema = z.string().min(1).max(64);
const CATEGORIES = STATUS_CATEGORIES.map((c) => c.value) as [string, ...string[]];
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #5b5bd6");

/** Confirm a child row belongs to a project the caller may manage. */
async function requireOwned(
  model: "workflowStatus" | "label" | "component" | "release" | "sprint",
  id: string,
) {
  const row = await (prisma[model] as { findUnique(a: unknown): Promise<{ projectId: string } | null> })
    .findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw new AuthError("Not found.", "NOT_FOUND");
  const ctx = await requirePermission("project:manage", { projectId: row.projectId });
  return { ctx, projectId: row.projectId };
}

function revalidateConfig() {
  for (const p of ["/settings", "/bugs", "/releases", "/roadmap", "/sprints"]) revalidatePath(p);
}

// ── Workflow statuses ────────────────────────────────────────────────────────

const statusSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1, "Name is required").max(40),
  category: z.enum(CATEGORIES),
  color: hexColor,
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createStatus(input: {
  projectId: string;
  name: string;
  category: string;
  color: string;
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await requirePermission("project:manage", { projectId: parsed.data.projectId });

  const clash = await prisma.workflowStatus.findFirst({
    where: { projectId: parsed.data.projectId, name: parsed.data.name },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "A status with that name already exists." };

  const last = await prisma.workflowStatus.findFirst({
    where: { projectId: parsed.data.projectId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await prisma.workflowStatus.create({
    data: { ...parsed.data, order: (last?.order ?? 0) + 1 },
  });
  revalidateConfig();
  return { ok: true };
}

export async function deleteStatus(statusId: string): Promise<ActionResult> {
  const id = idSchema.parse(statusId);
  const { projectId } = await requireOwned("workflowStatus", id);

  // Deleting a status that issues still point at would orphan them, so move
  // them to another status in the same project first.
  const inUse = await prisma.issue.count({ where: { statusId: id } });
  const fallback = await prisma.workflowStatus.findFirst({
    where: { projectId, id: { not: id } },
    orderBy: [{ isDefault: "desc" }, { order: "asc" }],
  });
  if (inUse > 0 && !fallback) {
    return { ok: false, error: "This is the only status; create another before deleting it." };
  }

  await prisma.$transaction(async (tx) => {
    if (inUse > 0 && fallback) {
      await tx.issue.updateMany({ where: { statusId: id }, data: { statusId: fallback.id } });
    }
    await tx.workflowStatus.delete({ where: { id } });
  });

  revalidateConfig();
  return { ok: true };
}

export async function setDefaultStatus(statusId: string): Promise<ActionResult> {
  const id = idSchema.parse(statusId);
  const { projectId } = await requireOwned("workflowStatus", id);
  await prisma.$transaction([
    prisma.workflowStatus.updateMany({ where: { projectId }, data: { isDefault: false } }),
    prisma.workflowStatus.update({ where: { id }, data: { isDefault: true } }),
  ]);
  revalidateConfig();
  return { ok: true };
}

/** Move a status one position up or down within its project. */
export async function moveStatus(statusId: string, direction: "up" | "down"): Promise<ActionResult> {
  const id = idSchema.parse(statusId);
  const dir = z.enum(["up", "down"]).parse(direction);
  const { projectId } = await requireOwned("workflowStatus", id);

  const all = await prisma.workflowStatus.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, order: true },
  });
  const i = all.findIndex((s) => s.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return { ok: true }; // already at the end

  await prisma.$transaction([
    prisma.workflowStatus.update({ where: { id: all[i].id }, data: { order: all[j].order } }),
    prisma.workflowStatus.update({ where: { id: all[j].id }, data: { order: all[i].order } }),
  ]);
  revalidateConfig();
  return { ok: true };
}

// ── Labels ───────────────────────────────────────────────────────────────────

const labelSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1, "Name is required").max(40),
  color: hexColor,
});

export async function createLabel(input: {
  projectId: string;
  name: string;
  color: string;
}): Promise<ActionResult> {
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await requirePermission("project:manage", { projectId: parsed.data.projectId });

  const clash = await prisma.label.findFirst({
    where: { projectId: parsed.data.projectId, name: parsed.data.name },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "A label with that name already exists." };

  await prisma.label.create({ data: parsed.data });
  revalidateConfig();
  return { ok: true };
}

export async function deleteLabel(labelId: string): Promise<ActionResult> {
  const id = idSchema.parse(labelId);
  await requireOwned("label", id);
  // IssueLabel cascades, so the label simply detaches from its issues.
  await prisma.label.delete({ where: { id } });
  revalidateConfig();
  return { ok: true };
}

// ── Components ───────────────────────────────────────────────────────────────

const componentSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1, "Name is required").max(60),
});

export async function createComponent(input: {
  projectId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = componentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await requirePermission("project:manage", { projectId: parsed.data.projectId });

  const clash = await prisma.component.findFirst({
    where: { projectId: parsed.data.projectId, name: parsed.data.name },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "A component with that name already exists." };

  await prisma.component.create({ data: parsed.data });
  revalidateConfig();
  return { ok: true };
}

export async function deleteComponent(componentId: string): Promise<ActionResult> {
  const id = idSchema.parse(componentId);
  await requireOwned("component", id);
  // Issue.componentId is optional, so detach rather than cascade-delete issues.
  await prisma.$transaction([
    prisma.issue.updateMany({ where: { componentId: id }, data: { componentId: null } }),
    prisma.component.delete({ where: { id } }),
  ]);
  revalidateConfig();
  return { ok: true };
}

// ── Releases ─────────────────────────────────────────────────────────────────

const releaseSchema = z.object({
  projectId: idSchema,
  version: z.string().trim().min(1, "Version is required").max(50),
  name: z.string().trim().max(200).default(""),
  description: z.string().trim().max(2000).default(""),
  releaseDate: z.string().trim().max(40).optional().nullable(),
});

export async function createProjectRelease(input: {
  projectId: string;
  version: string;
  name?: string;
  description?: string;
  releaseDate?: string | null;
}): Promise<ActionResult> {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await requirePermission("release:manage", { projectId: parsed.data.projectId });

  const clash = await prisma.release.findFirst({
    where: { projectId: parsed.data.projectId, version: parsed.data.version },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "That version already exists in this project." };

  let releaseDate: Date | null = null;
  if (parsed.data.releaseDate) {
    const d = new Date(parsed.data.releaseDate);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "That release date isn't valid." };
    releaseDate = d;
  }

  await prisma.release.create({
    data: {
      projectId: parsed.data.projectId,
      version: parsed.data.version,
      name: parsed.data.name,
      description: parsed.data.description,
      releaseDate,
    },
  });
  revalidateConfig();
  return { ok: true };
}

export async function setReleaseStatus(releaseId: string, status: string): Promise<ActionResult> {
  const id = idSchema.parse(releaseId);
  const value = z.enum(["planned", "in_progress", "released", "rolled_back"]).parse(status);
  const row = await prisma.release.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw new AuthError("Release not found.", "NOT_FOUND");
  await requirePermission("release:manage", { projectId: row.projectId });

  await prisma.release.update({
    where: { id },
    data: { status: value, ...(value === "released" ? { releasedAt: new Date() } : {}) },
  });
  revalidateConfig();
  return { ok: true };
}

// ── Sprints ──────────────────────────────────────────────────────────────────

const sprintSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1, "Name is required").max(120),
  goal: z.string().trim().max(500).default(""),
  startDate: z.string().trim().max(40).optional().nullable(),
  endDate: z.string().trim().max(40).optional().nullable(),
});

export async function createProjectSprint(input: {
  projectId: string;
  name: string;
  goal?: string;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<ActionResult> {
  const parsed = sprintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await requirePermission("sprint:manage", { projectId: parsed.data.projectId });

  const toDate = (v?: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const startDate = toDate(parsed.data.startDate);
  const endDate = toDate(parsed.data.endDate);
  if (startDate === undefined || endDate === undefined) {
    return { ok: false, error: "Those dates aren't valid." };
  }
  if (startDate && endDate && endDate < startDate) {
    return { ok: false, error: "The sprint ends before it starts." };
  }

  await prisma.sprint.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      goal: parsed.data.goal,
      startDate,
      endDate,
    },
  });
  revalidateConfig();
  return { ok: true };
}

export async function setSprintStatus(sprintId: string, status: string): Promise<ActionResult> {
  const id = idSchema.parse(sprintId);
  const value = z.enum(["planned", "active", "completed"]).parse(status);
  const row = await prisma.sprint.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw new AuthError("Sprint not found.", "NOT_FOUND");
  await requirePermission("sprint:manage", { projectId: row.projectId });

  // Only one sprint can be active at a time per project.
  if (value === "active") {
    await prisma.sprint.updateMany({
      where: { projectId: row.projectId, status: "active", id: { not: id } },
      data: { status: "completed" },
    });
  }
  await prisma.sprint.update({ where: { id }, data: { status: value } });
  revalidateConfig();
  return { ok: true };
}

/** Guard against a caller passing a value the schema does not know. */
export async function assertKnownCategory(category: string) {
  if (!CATEGORIES.includes(category)) throw new ValidationError("Unknown status category.");
  return { ok: true };
}
