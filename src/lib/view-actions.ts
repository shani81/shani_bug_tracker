"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, AuthError } from "@/lib/permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Saved views — a named filter someone can come back to, optionally shared
// with the rest of the organization.
//
// Anyone signed in may manage their OWN views. Sharing makes a view readable
// org-wide but still only editable by its author (or an admin).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VIEWS_PER_USER = 50;

/** Only these keys are persisted; anything else in the filter is discarded. */
const filterSchema = z
  .object({
    projectId: z.string().max(64),
    statusId: z.string().max(64),
    priority: z.string().max(40),
    severity: z.string().max(40),
    assigneeId: z.string().max(64),
    labelId: z.string().max(64),
    search: z.string().max(200),
    view: z.enum(["list", "board"]),
  })
  .partial();

export type ViewFilter = z.infer<typeof filterSchema>;

const saveSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  group: z.enum(["bug", "feature", "improvement", "task"]),
  filter: filterSchema,
  isShared: z.boolean().default(false),
});

export type SaveViewResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveView(input: {
  name: string;
  group: string;
  filter: ViewFilter;
  isShared?: boolean;
}): Promise<SaveViewResult> {
  const ctx = await requireAuth();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // A shared view appears in every member's toolbar, so it is a small content
  // -injection surface: guests (external accounts) may keep private views only.
  if (parsed.data.isShared && ctx.orgRole === "guest") {
    return { ok: false, error: "Guest accounts can only create private views." };
  }

  const count = await prisma.savedSearch.count({ where: { userId: ctx.userId } });
  if (count >= MAX_VIEWS_PER_USER) {
    return { ok: false, error: "You have too many saved views. Delete one first." };
  }

  const row = await prisma.savedSearch.create({
    data: {
      userId: ctx.userId,
      orgId: ctx.orgId,
      name: parsed.data.name,
      group: parsed.data.group,
      queryJson: JSON.stringify(parsed.data.filter),
      isShared: parsed.data.isShared,
    },
  });

  revalidatePath("/bugs");
  return { ok: true, id: row.id };
}

export async function deleteView(viewId: string) {
  const ctx = await requireAuth();
  const id = z.string().min(1).max(64).parse(viewId);

  // Admins may tidy up SHARED views; nobody may delete someone else's private
  // view, which would otherwise be a blind destructive action.
  const isAdmin = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const res = await prisma.savedSearch.deleteMany({
    where: isAdmin
      ? { id, orgId: ctx.orgId, OR: [{ userId: ctx.userId }, { isShared: true }] }
      : { id, userId: ctx.userId },
  });
  if (res.count === 0) throw new AuthError("View not found.", "NOT_FOUND");

  revalidatePath("/bugs");
  return { ok: true };
}

export async function setViewShared(viewId: string, isShared: boolean) {
  const ctx = await requireAuth();
  const id = z.string().min(1).max(64).parse(viewId);
  const shared = z.boolean().parse(isShared);

  // only the author decides whether their view is shared
  const res = await prisma.savedSearch.updateMany({
    where: { id, userId: ctx.userId },
    data: { isShared: shared },
  });
  if (res.count === 0) throw new AuthError("View not found.", "NOT_FOUND");

  revalidatePath("/bugs");
  return { ok: true };
}
