import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/permissions";

/**
 * The calling user, or null.
 *
 * Resolves through getAuthContext, so this is correct for BOTH a cookie session
 * and an API token — every query built on it is scoped identically regardless
 * of how the request authenticated.
 */
export const getCurrentUser = cache(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return prisma.user.findUnique({ where: { id: ctx.userId } });
});

/** The organization the caller is acting in, or null. */
export const getActiveOrg = cache(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return prisma.organization.findUnique({ where: { id: ctx.orgId } });
});
