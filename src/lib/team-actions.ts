"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, destroyAllSessions, createSession } from "@/lib/auth";
import { requireAuth, requirePermission, AuthError } from "@/lib/permissions";
import {
  checkCredentialThrottle,
  recordCredentialFailure,
  clearCredentialThrottle,
} from "@/lib/auth-actions";
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

/** Public — reads a pending invite for the acceptance page. Never leaks the org id. */
export async function peekInvitation(token: string) {
  if (!token) return null;
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: { select: { name: true, logoColor: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) return null;
  return { email: inv.email, role: inv.role, orgName: inv.org.name, orgColor: inv.org.logoColor };
}

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120).default(""),
});

export type AcceptState = { error?: string; ok?: boolean };

/** Public — consumes an invite, creates/links the account and signs them in. */
export async function acceptInvitationAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const parsed = acceptSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    name: formData.get("name"),
    title: formData.get("title") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { token, password, name, title } = parsed.data;

  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) {
    return { error: "This invitation is no longer valid. Ask an admin for a new link." };
  }

  const existing = await prisma.user.findUnique({
    where: { email: inv.email },
    select: { id: true },
  });

  // ── Account-takeover guard ────────────────────────────────────────────────
  // Holding an invite link proves nothing about controlling the mailbox (there
  // is no mail delivery here — an admin copies the link). So an invite may
  // never set credentials on, or mint a session for, an account that ALREADY
  // EXISTS — otherwise anyone able to mint an invite for a known address could
  // log in as that person. Note the test is existence, not "has a password":
  // a password-less row is still someone else's account (e.g. one created
  // before password auth existed), and treating it as claimable would be the
  // same takeover. Those accounts need an admin-driven password reset, not an
  // invite. An existing user must sign in first and accept as themselves.
  if (existing) {
    const me = await getSessionUser();
    if (!me || me.id !== existing.id) {
      return {
        error:
          "This invitation is for an account that already exists. Sign in with that account first, then open this link again.",
      };
    }
    await prisma.$transaction(async (tx) => {
      // conditional claim: only one concurrent accept can win
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("Invitation already used");
      await tx.membership.upsert({
        where: { orgId_userId: { orgId: inv.orgId, userId: existing.id } },
        create: { orgId: inv.orgId, userId: existing.id, role: inv.role },
        update: {},
      });
    });
    // already signed in as themselves — no new session is minted
    return { ok: true };
  }

  // Brand-new address: no account exists, so creating one and signing them in
  // is exactly what the invite authorises.
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    // Claim the invitation with a conditional write BEFORE doing any work, so
    // two simultaneous submissions cannot both succeed. A plain read-then-write
    // would race under READ COMMITTED (Postgres in production).
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Invitation already used");

    const u = await tx.user.create({
      data: {
        email: inv.email,
        name,
        title: title || null,
        passwordHash,
        orgId: inv.orgId,
        color: `hsl(${Math.abs(hashCode(inv.email)) % 360} 65% 55%)`,
      },
    });

    await tx.membership.create({ data: { orgId: inv.orgId, userId: u.id, role: inv.role } });
    return u;
  });

  await createSession(user.id);
  return { ok: true };
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
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
  if (await checkCredentialThrottle(throttleKey)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  // proving knowledge of the current password is what makes this safe to expose
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(parsed.data.currentPassword, full?.passwordHash ?? null))) {
    await recordCredentialFailure(throttleKey);
    return { error: "Your current password is incorrect." };
  }
  await clearCredentialThrottle(throttleKey);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });

  // Invalidate every session (including this one), then re-issue for the
  // current browser — a stolen cookie must not survive a password change.
  await destroyAllSessions(user.id);
  await createSession(user.id);

  revalidatePath("/settings");
  return { ok: true };
}
