"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, AuthError } from "@/lib/permissions";
import { generateToken, SCOPES } from "@/lib/api-auth";

// API tokens are personal: any signed-in member may manage their OWN tokens,
// and a token can never grant more than its owner already has (see the scope
// clamp in permissions.ts). Nobody can see or revoke someone else's.

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z.array(z.enum(SCOPES)).min(1, "Pick at least one scope"),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

export type CreateTokenResult =
  | { ok: true; token: string; prefix: string }
  | { ok: false; error: string };

const MAX_TOKENS_PER_USER = 20;

export async function createApiToken(input: {
  name: string;
  scopes: string[];
  expiresInDays?: number | null;
}): Promise<CreateTokenResult> {
  // Minting a token must be a session action: allowing a token to mint another
  // token would let a leaked read token bootstrap a write token.
  const ctx = await requireAuth();
  if (ctx.via !== "session") {
    return { ok: false, error: "API tokens can only be created from the web app." };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const live = await prisma.apiToken.count({ where: { userId: ctx.userId, revokedAt: null } });
  if (live >= MAX_TOKENS_PER_USER) {
    return { ok: false, error: "You have too many active tokens. Revoke one first." };
  }

  const { raw, tokenHash, prefix } = generateToken();
  await prisma.apiToken.create({
    data: {
      name: parsed.data.name,
      tokenHash,
      prefix,
      scopes: parsed.data.scopes.join(","),
      userId: ctx.userId,
      orgId: ctx.orgId,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86400_000)
        : null,
    },
  });

  revalidatePath("/settings");
  // returned exactly once — only the hash is stored
  return { ok: true, token: raw, prefix };
}

export async function revokeApiToken(tokenId: string) {
  const ctx = await requireAuth();
  const id = z.string().min(1).max(64).parse(tokenId);

  // scoped to the caller: someone else's id simply matches nothing
  const res = await prisma.apiToken.updateMany({
    where: { id, userId: ctx.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw new AuthError("Token not found.", "NOT_FOUND");

  revalidatePath("/settings");
  return { ok: true };
}
