"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSession, getSessionUser } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Invitation ACCEPTANCE only.
//
// This module is imported by the public /invite page, and every export of a
// "use server" file becomes an HTTP endpoint reachable from any route that
// imports it. Admin operations (invite, revoke, role changes) therefore live in
// team-actions.ts, which is only ever imported by the authenticated settings
// screen — keeping them off the unauthenticated invite route.
// ─────────────────────────────────────────────────────────────────────────────

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

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

