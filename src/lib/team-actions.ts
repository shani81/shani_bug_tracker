"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, destroyAllSessions, createSession } from "@/lib/auth";
import { requireAuth, requirePermission, AuthError } from "@/lib/permissions";
import { isThrottled, recordFailure, clearThrottle } from "@/lib/throttle";
import { getSessionUser } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Team & account management.
//
// Every export here is a public RPC endpoint, so each one independently
// verifies (a) the caller is signed in, (b) they hold the right capability and
// (c) the target user shares their organization. Role changes additionally
// refuse to escalate past the caller's own role or to strand the org without
// an owner.
// ─────────────────────────────────────────────────────────────────────────────

const INVITE_DAYS = 7;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// TypeScript types are erased at runtime and these actions are public HTTP
// endpoints, so positional arguments must be validated. Without this a caller
// could pass a Prisma filter object (e.g. { not: "" }) where a string id is
// assumed and match rows wholesale.
const idSchema = z.string().min(1).max(64);
const roleSchema = z.enum(["owner", "admin", "member", "guest"]);

/** Roles a caller may grant, never above their own. */
function grantableRoles(actorRole: string): string[] {
  if (actorRole === "owner") return ["owner", "admin", "member", "guest"];
  if (actorRole === "admin") return ["member", "guest"];
  return [];
}

/**
 * Refuse to leave an org without a *reachable* owner.
 *
 * Counts only owners who can actually sign in — a deactivated owner cannot
 * administer anything, so counting them would allow an org to be bricked (no
 * one holding org:manage, and admins may neither promote to owner nor
 * reactivate an owner). Callers run this inside the same transaction as the
 * write, so the count cannot go stale between check and mutation.
 */
async function assertNotLastOwner(
  tx: Pick<typeof prisma, "membership">,
  orgId: string,
  userId: string,
) {
  const target = await tx.membership.findFirst({ where: { orgId, userId }, select: { role: true } });
  if (target?.role !== "owner") return;
  const activeOwners = await tx.membership.count({
    where: { orgId, role: "owner", user: { isActive: true } },
  });
  if (activeOwners <= 1) {
    throw new AuthError("This is the last active owner — promote someone else first.", "FORBIDDEN");
  }
}

// ── Invitations ──────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  name: z.string().trim().min(1, "Name is required").max(120),
  role: z.string(),
  title: z.string().trim().max(120).default(""),
});

export type InviteResult = { ok: true; inviteUrl: string } | { ok: false; error: string };

/**
 * Create a pending invitation and return a single-use link. There is no mail
 * delivery here, so the admin shares the link out of band.
 */
export async function inviteMember(input: {
  email: string;
  name: string;
  role: string;
  title?: string;
}): Promise<InviteResult> {
  const ctx = await requirePermission("member:manage");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { email, name, role, title } = parsed.data;

  if (!grantableRoles(ctx.orgRole).includes(role)) {
    return { ok: false, error: `You cannot grant the "${role}" role.` };
  }

  // already a member of this org?
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const member = await prisma.membership.findFirst({
      where: { orgId: ctx.orgId, userId: existing.id },
      select: { id: true },
    });
    if (member) return { ok: false, error: "That person is already a member of this workspace." };
  }

  const outstanding = await prisma.invitation.count({
    where: { orgId: ctx.orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (outstanding >= 200) {
    return { ok: false, error: "Too many pending invitations. Revoke some before sending more." };
  }

  // supersede any outstanding invite for the same address
  await prisma.invitation.updateMany({
    where: { orgId: ctx.orgId, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      orgId: ctx.orgId,
      email,
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
      invitedById: ctx.userId,
    },
  });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const inviteUrl = `${proto}://${host}/invite/${token}?name=${encodeURIComponent(name)}${
    title ? `&title=${encodeURIComponent(title)}` : ""
  }`;

  revalidatePath("/settings");
  return { ok: true, inviteUrl };
}

export async function revokeInvitation(invitationId: string) {
  const ctx = await requirePermission("member:manage");
  const id = idSchema.parse(invitationId);
  // scoped update: an id from another org matches nothing
  await prisma.invitation.updateMany({
    where: { id, orgId: ctx.orgId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings");
  return { ok: true };
}

// ── Membership administration ────────────────────────────────────────────────

export async function changeMemberRole(userIdInput: string, roleInput: string) {
  const ctx = await requirePermission("member:manage");
  const userId = idSchema.parse(userIdInput);
  const role = roleSchema.parse(roleInput);

  if (!grantableRoles(ctx.orgRole).includes(role)) {
    throw new AuthError(`You cannot grant the "${role}" role.`, "FORBIDDEN");
  }
  const membership = await prisma.membership.findFirst({
    where: { orgId: ctx.orgId, userId },
    select: { id: true, role: true },
  });
  if (!membership) throw new AuthError("Member not found.", "NOT_FOUND");

  // an admin may not modify an owner/admin; only an owner can
  if (ctx.orgRole !== "owner" && (membership.role === "owner" || membership.role === "admin")) {
    throw new AuthError("Only an owner can change that member's role.", "FORBIDDEN");
  }

  // Guard and write in one transaction: two concurrent demotions must not both
  // observe "there are still 2 owners" and both succeed.
  await prisma.$transaction(async (tx) => {
    if (membership.role === "owner" && role !== "owner") {
      await assertNotLastOwner(tx, ctx.orgId, userId);
    }
    await tx.membership.update({ where: { id: membership.id }, data: { role } });
  });

  revalidatePath("/settings");
  return { ok: true };
}

export async function setMemberActive(userIdInput: string, isActiveInput: boolean) {
  const ctx = await requirePermission("member:manage");
  const userId = idSchema.parse(userIdInput);
  const isActive = z.boolean().parse(isActiveInput);
  if (userId === ctx.userId) {
    throw new AuthError("You cannot deactivate your own account.", "FORBIDDEN");
  }
  const membership = await prisma.membership.findFirst({
    where: { orgId: ctx.orgId, userId },
    select: { id: true, role: true },
  });
  if (!membership) throw new AuthError("Member not found.", "NOT_FOUND");
  if (ctx.orgRole !== "owner" && (membership.role === "owner" || membership.role === "admin")) {
    throw new AuthError("Only an owner can deactivate that member.", "FORBIDDEN");
  }

  await prisma.$transaction(async (tx) => {
    if (!isActive) await assertNotLastOwner(tx, ctx.orgId, userId);
    // Flip access to THIS org only. Using User.isActive here would lock the
    // person out of every other workspace they belong to.
    await tx.membership.update({ where: { id: membership.id }, data: { isActive } });
  });

  // Revoking access must kill live sessions, not just block future logins —
  // but only when this org is the one their session resolves to.
  if (!isActive) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (target?.orgId === ctx.orgId) await destroyAllSessions(userId);
  }

  revalidatePath("/settings");
  return { ok: true };
}

// ── Self-service password change ─────────────────────────────────────────────

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
});

export type PasswordState = { error?: string; ok?: boolean };

export async function changeOwnPasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  await requireAuth();
  const user = await getSessionUser();
  if (!user) return { error: "You must be signed in." };

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Rate-limited: a hijacked session must not be able to grind the current
  // password to convert temporary access into permanent ownership.
  const throttleKey = `pwchange:${user.id}`;
  if (isThrottled(throttleKey)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  // proving knowledge of the current password is what makes this safe to expose
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(parsed.data.currentPassword, full?.passwordHash ?? null))) {
    recordFailure(throttleKey);
    return { error: "Your current password is incorrect." };
  }
  clearThrottle(throttleKey);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });

  // Invalidate every session (including this one), then re-issue for the
  // current browser — a stolen cookie must not survive a password change.
  // API tokens go too: an attacker who minted one from a hijacked session
  // would otherwise keep access after the victim "secured" the account.
  await destroyAllSessions(user.id);
  await prisma.apiToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await createSession(user.id);

  revalidatePath("/settings");
  return { ok: true };
}

// ── Admin-issued password reset ──────────────────────────────────────────────

const RESET_HOURS = 2;

export type ResetLinkResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Issue a single-use password reset link for a member.
 *
 * Requires member:manage and is scoped to the caller's org. There is no mail
 * delivery in this build, so the admin shares the link out of band — the same
 * tradeoff as invitations.
 */
export async function issuePasswordReset(userIdInput: string): Promise<ResetLinkResult> {
  const ctx = await requirePermission("member:manage");
  const userId = idSchema.parse(userIdInput);

  const membership = await prisma.membership.findFirst({
    where: { orgId: ctx.orgId, userId },
    select: { role: true },
  });
  if (!membership) return { ok: false, error: "Member not found." };

  // An admin must not be able to seize an owner's (or another admin's)
  // account by resetting their password — that would be privilege escalation.
  if (ctx.orgRole !== "owner" && (membership.role === "owner" || membership.role === "admin")) {
    return { ok: false, error: "Only an owner can reset that member's password." };
  }

  // supersede any outstanding reset for this user
  await prisma.passwordReset.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_HOURS * 3600_000),
      issuedById: ctx.userId,
    },
  });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";

  revalidatePath("/settings");
  return { ok: true, url: `${proto}://${host}/reset/${token}` };
}
