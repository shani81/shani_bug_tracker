"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, destroyAllSessions } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Password reset — CONSUMPTION only.
//
// This module is imported by the public /reset page, so its export list is a
// public API. Issuing a reset is an admin operation and lives in
// team-actions.ts, which only the authenticated settings screen imports.
// ─────────────────────────────────────────────────────────────────────────────

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export type ResetState = { error?: string; ok?: boolean };

export async function completePasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) {
    return { error: "This reset link is no longer valid. Ask an admin for a new one." };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.$transaction(async (tx) => {
    // Claim the token first with a conditional write: two concurrent
    // submissions must not both succeed.
    const claimed = await tx.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Reset link already used");

    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });

    // Any other outstanding reset for this user is now void.
    await tx.passwordReset.updateMany({
      where: { userId: reset.userId, usedAt: null, id: { not: reset.id } },
      data: { usedAt: new Date() },
    });

    // A reset exists because access may be compromised, so revoke API tokens
    // too — otherwise an attacker who minted one keeps access afterwards.
    await tx.apiToken.updateMany({
      where: { userId: reset.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  // Kill every existing session. Deliberately no auto-login: the person
  // holding the link has not proven they are the account owner beyond
  // possessing it, so they sign in with the new password like anyone else.
  await destroyAllSessions(reset.userId);

  return { ok: true };
}
