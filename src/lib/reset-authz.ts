import "server-only";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Who may reset whose password.
//
// `User.passwordHash` is a single GLOBAL credential, but authorization is
// per-organization. That mismatch is the whole problem: without care, an admin
// of a low-value workspace could reset the password of someone who happens to
// own a different workspace, then sign in there.
//
// The same rule therefore runs twice — when the link is issued, and again when
// it is consumed — because roles and memberships can change in between.
// ─────────────────────────────────────────────────────────────────────────────

export type ResetAuthz = { ok: true } | { ok: false; error: string };

export async function canResetPassword(opts: {
  orgId: string;
  issuerId: string;
  targetId: string;
}): Promise<ResetAuthz> {
  const { orgId, issuerId, targetId } = opts;

  const [issuer, target, elsewhere] = await Promise.all([
    prisma.membership.findFirst({
      where: { orgId, userId: issuerId, isActive: true },
      select: { role: true },
    }),
    prisma.membership.findFirst({
      // an off-boarded member must not stay resettable forever
      where: { orgId, userId: targetId, isActive: true },
      select: { role: true },
    }),
    // Authority the target holds OUTSIDE this org, which this org's admins
    // have no standing to take over.
    prisma.membership.count({ where: { userId: targetId, orgId: { not: orgId }, isActive: true } }),
  ]);

  if (!issuer || (issuer.role !== "owner" && issuer.role !== "admin")) {
    return { ok: false, error: "You do not have permission to reset passwords." };
  }
  if (!target) {
    return { ok: false, error: "Member not found." };
  }
  if (elsewhere > 0) {
    return {
      ok: false,
      error:
        "This person belongs to other workspaces, so their password can't be reset from here. They should use their own account recovery.",
    };
  }
  // An admin must not seize an owner's or a peer admin's account.
  if (issuer.role !== "owner" && (target.role === "owner" || target.role === "admin")) {
    return { ok: false, error: "Only an owner can reset that member's password." };
  }
  return { ok: true };
}
