import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Read a pending invite for the acceptance page.
 *
 * A plain server-only query, NOT a "use server" export: the public /invite
 * route must not pull a module whose other exports are admin endpoints.
 */
export async function peekInvitation(token: string) {
  if (!token) return null;
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: { select: { name: true, logoColor: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) return null;
  return { email: inv.email, role: inv.role, orgName: inv.org.name, orgColor: inv.org.logoColor };
}

