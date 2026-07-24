import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getAuthContext } from "@/lib/permissions";

/**
 * The signed-in user, or null. Backed by a real session cookie —
 * every data-access path scopes to whatever this returns.
 */
export const getCurrentUser = cache(async () => {
  return getSessionUser();
});

/** The organization the signed-in user belongs to, or null. */
export const getActiveOrg = cache(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return prisma.organization.findUnique({ where: { id: ctx.orgId } });
});
