import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getApiIdentity } from "@/lib/api-auth";
import { isApiRequest } from "@/lib/request-context";

// ─────────────────────────────────────────────────────────────────────────────
// Capability-based RBAC.
//
// Two role dimensions:
//   • org role      (Membership.role)    — owner | admin | member | guest
//   • project role  (ProjectMember.role) — lead | manager | developer | qa |
//                                          designer | support | viewer
//
// Effective capabilities = org-role grants, then refined by the project role
// when the action targets a specific project. `viewer` is a hard read-only
// clamp unless the user is an org owner/admin.
// ─────────────────────────────────────────────────────────────────────────────

export const CAPABILITIES = [
  "issue:create",
  "issue:update",
  "issue:transition",
  "issue:assign",
  "issue:delete",
  "comment:create",
  "comment:moderate",
  "time:log",
  "qa:record",
  "qa:manage",
  "release:manage",
  "sprint:manage",
  "project:manage",
  "automation:manage",
  "member:manage",
  "org:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL: Capability[] = [...CAPABILITIES];

const CONTRIBUTOR: Capability[] = [
  "issue:create",
  "issue:update",
  "issue:transition",
  "issue:assign",
  "comment:create",
  "time:log",
  "qa:record",
];

/** Capabilities granted purely by the organization role. */
const ORG_ROLE_CAPS: Record<string, Capability[]> = {
  owner: ALL,
  admin: ALL.filter((c) => c !== "org:manage"),
  member: CONTRIBUTOR,
  guest: ["issue:create", "comment:create"],
};

/** Extra capabilities granted by an elevated project role. */
const PROJECT_ROLE_EXTRA: Record<string, Capability[]> = {
  lead: ["issue:delete", "comment:moderate", "qa:manage", "release:manage", "sprint:manage", "project:manage"],
  manager: ["issue:delete", "comment:moderate", "release:manage", "sprint:manage"],
  qa: ["qa:manage"],
  developer: [],
  designer: [],
  support: [],
  viewer: [],
};

/**
 * Hard ceiling per org role. A project role may refine what someone can do
 * inside a project, but it can never lift them above their organization role —
 * otherwise a guest made project lead would outrank a full member.
 */
const ORG_ROLE_CEILING: Record<string, Capability[]> = {
  owner: ALL,
  admin: ALL.filter((c) => c !== "org:manage"),
  member: [...CONTRIBUTOR, "issue:delete", "comment:moderate", "qa:manage", "release:manage", "sprint:manage", "project:manage"],
  guest: ["issue:create", "comment:create"],
};

export type AuthContext = {
  userId: string;
  name: string;
  email: string;
  orgId: string;
  orgRole: string;
  /** how the caller authenticated — a token additionally carries scopes */
  via: "session" | "token";
  scopes: readonly string[];
};

/**
 * An error whose message is safe to show the caller. The API error handler
 * echoes only this type — everything else becomes a generic 500 — so internal
 * failures never leak infrastructure details.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * The caller's identity and org membership, or null.
 *
 * Bearer tokens are accepted ONLY on /api/v1 requests (see runAsApiRequest).
 * Server actions are always cookie-authenticated: a token is not a session, and
 * accepting one there would turn every action in the app — including team
 * administration — into a token-reachable endpoint.
 *
 * Once resolved, both credential types produce the same shape, so every
 * downstream permission check is identical.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const user = await getSessionUser();

  if (!user) {
    if (!isApiRequest()) return null;
    // no cookie, and this is an API request — try an API token
    const id = await getApiIdentity();
    if (!id) return null;
    const u = await prisma.user.findUnique({
      where: { id: id.userId },
      select: { name: true, email: true },
    });
    if (!u) return null;
    return {
      userId: id.userId,
      name: u.name,
      email: u.email,
      orgId: id.orgId,
      orgRole: id.orgRole,
      via: "token",
      scopes: id.scopes,
    };
  }

  // isActive: an org can revoke someone's access without disabling the account
  // platform-wide, so a deactivated membership yields no context at all.
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, isActive: true, ...(user.orgId ? { orgId: user.orgId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    orgId: membership.orgId,
    orgRole: membership.role,
    via: "session",
    // a cookie session carries the user's full authority
    scopes: ["read", "write"],
  };
});

/**
 * A read-scoped token may not mutate anything, however privileged its owner is.
 */
function assertWriteScope(ctx: AuthContext) {
  if (ctx.via === "token" && !ctx.scopes.includes("write")) {
    throw new AuthError("This API token is read-only.", "FORBIDDEN");
  }
}

/**
 * Gate for any operation that MUTATES state.
 *
 * The write-scope check lives here rather than only in requirePermission
 * because several actions (marking notifications read, revoking a token,
 * changing your own password) legitimately need no capability but are still
 * writes — without this they would be reachable with a read-only token.
 * Read paths must use getAuthContext() directly, not this.
 */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthError("You must be signed in.", "UNAUTHENTICATED");
  assertWriteScope(ctx);
  return ctx;
}

/**
 * Pure capability check.
 *
 * Model: projects are open within an organization — a user with no
 * ProjectMember row gets exactly their org-role capabilities. A ProjectMember
 * row can *refine* that: elevated roles add capabilities (bounded by the org
 * ceiling), and `viewer` clamps to read-only.
 */
export function can(orgRole: string, cap: Capability, projectRole?: string | null): boolean {
  const base = ORG_ROLE_CAPS[orgRole] ?? [];
  const isOrgAdmin = orgRole === "owner" || orgRole === "admin";

  // A project viewer is read-only, even if the org role is broader —
  // unless they administer the whole org.
  if (projectRole === "viewer" && !isOrgAdmin) return false;

  if (base.includes(cap)) return true;

  if (projectRole && !isOrgAdmin) {
    const extra = PROJECT_ROLE_EXTRA[projectRole] ?? [];
    const ceiling = ORG_ROLE_CEILING[orgRole] ?? [];
    // a project role can refine, never escalate past the org role
    return extra.includes(cap) && ceiling.includes(cap);
  }
  return false;
}

async function projectRoleFor(userId: string, projectId: string): Promise<string | null> {
  const pm = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return pm?.role ?? null;
}

/**
 * Assert the caller may perform `cap`. When `projectId` is supplied the project
 * is verified to belong to the caller's organization (prevents cross-tenant
 * access) and the project role is factored in.
 */
export async function requirePermission(
  cap: Capability,
  opts?: { projectId?: string },
): Promise<AuthContext> {
  const ctx = await requireAuth();

  let projectRole: string | null = null;
  if (opts?.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: opts.projectId },
      select: { orgId: true },
    });
    // Do not leak existence of other tenants' projects.
    if (!project || project.orgId !== ctx.orgId) {
      throw new AuthError("Project not found.", "NOT_FOUND");
    }
    projectRole = await projectRoleFor(ctx.userId, opts.projectId);
  }

  if (!can(ctx.orgRole, cap, projectRole)) {
    throw new AuthError(`You do not have permission to ${cap.replace(":", " ")}.`, "FORBIDDEN");
  }
  return ctx;
}

/**
 * Load an issue, proving it belongs to the caller's org, and assert `cap`.
 * This is the guard that closes IDOR on every issue-scoped mutation.
 */
export async function requireIssueAccess(issueId: string, cap: Capability) {
  const ctx = await requireAuth();
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true, projectId: true, reporterId: true, project: { select: { orgId: true } } },
  });
  if (!issue || issue.project.orgId !== ctx.orgId) {
    throw new AuthError("Issue not found.", "NOT_FOUND");
  }
  const projectRole = await projectRoleFor(ctx.userId, issue.projectId);
  if (!can(ctx.orgRole, cap, projectRole)) {
    throw new AuthError(`You do not have permission to ${cap.replace(":", " ")}.`, "FORBIDDEN");
  }
  return { ctx, issue };
}

/**
 * Capability set for the current user at org level — used to gate the UI.
 * Project-specific refinements are not applied here; the server re-checks the
 * real project role on every mutation.
 */
export async function getUiCapabilities(): Promise<Capability[]> {
  const ctx = await getAuthContext();
  if (!ctx) return [];
  return ALL.filter((c) => can(ctx.orgRole, c));
}
