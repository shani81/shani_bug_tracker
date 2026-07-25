import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Read a pending reset for the public reset page.
 *
 * A plain server-only query, NOT a "use server" export — the public route must
 * not pull in a module whose other exports are privileged endpoints.
 * Returns only what the page needs to render; never the user id.
 */
export async function peekPasswordReset(token: string) {
  if (!token) return null;
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) return null;
  return { email: reset.user.email, name: reset.user.name };
}
