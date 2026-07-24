import { cache } from "react";
import { prisma } from "@/lib/prisma";

// Auth is stubbed for now: the "current user" is a fixed seeded account.
// Swap this for a real session (NextAuth / Clerk / custom) later — every caller
// already goes through getCurrentUser(), so the rest of the app won't change.
export const CURRENT_USER_EMAIL = "you@shani.dev";

export const getCurrentUser = cache(async () => {
  const user = await prisma.user.findUnique({ where: { email: CURRENT_USER_EMAIL } });
  if (user) return user;
  // fallback to any user so the app never hard-fails before seeding
  return prisma.user.findFirst();
});

export const getActiveOrg = cache(async () => {
  const user = await getCurrentUser();
  if (user?.orgId) {
    const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
    if (org) return org;
  }
  return prisma.organization.findFirst();
});
