import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Personal access tokens for the public REST API.
//
// A token authenticates AS a user, but its scopes clamp what it can do: a
// read-scoped token belonging to an owner still cannot write. Authorization
// itself is unchanged — the same capability model backs both cookie sessions
// and API tokens, so there is exactly one place where access is decided.
// ─────────────────────────────────────────────────────────────────────────────

export const TOKEN_PREFIX = "bt_";
export const SCOPES = ["read", "write"] as const;
export type Scope = (typeof SCOPES)[number];

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Returns the raw token (shown once) and the fields to persist. */
export function generateToken() {
  const raw = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { raw, tokenHash: hash(raw), prefix: raw.slice(0, TOKEN_PREFIX.length + 6) };
}

export type ApiIdentity = {
  userId: string;
  orgId: string;
  orgRole: string;
  scopes: Scope[];
  tokenId: string;
  lastUsedAt: Date | null;
};

function parseScopes(raw: string): Scope[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
}

/**
 * Resolve `Authorization: Bearer <token>` to an identity, or null.
 *
 * Checks, in order: token exists, not revoked, not expired, the owning user is
 * active, and their membership in the token's org is still active. A token is
 * therefore killed by revoking it, disabling the account, or removing the
 * user from the org — no separate revocation path to forget.
 */
export const getApiIdentity = cache(async (): Promise<ApiIdentity | null> => {
  const h = await headers();
  const auth = h.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;

  const raw = auth.slice(7).trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hash(raw) },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (!token || token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;
  if (!token.user.isActive) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: token.userId, orgId: token.orgId, isActive: true },
    select: { role: true },
  });
  if (!membership) return null;

  return {
    userId: token.userId,
    orgId: token.orgId,
    orgRole: membership.role,
    scopes: parseScopes(token.scopes),
    tokenId: token.id,
    lastUsedAt: token.lastUsedAt,
  };
});

/**
 * Best-effort usage stamp; never blocks or fails a request.
 *
 * Coarse on purpose: writing on every call would serialise a busy token's
 * requests on a single row lock. Five-minute granularity is plenty for
 * "when was this token last used".
 */
const STAMP_INTERVAL_MS = 5 * 60_000;

export async function touchToken(tokenId: string, lastUsedAt: Date | null) {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < STAMP_INTERVAL_MS) return;
  await prisma.apiToken
    .update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
}
