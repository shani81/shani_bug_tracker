import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, ValidationError, getAuthContext, type AuthContext } from "@/lib/permissions";
import { runAsApiRequest } from "@/lib/request-context";
import { touchToken, getApiIdentity } from "@/lib/api-auth";
import { allowApiRequest } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Shared plumbing for /api/v1. Keeps every endpoint's auth, error shape and
// status codes identical instead of re-deriving them per route.
// ─────────────────────────────────────────────────────────────────────────────

export type ApiError = { error: { code: string; message: string } };

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/** Map a thrown error to the right status without leaking internals. */
export function toErrorResponse(e: unknown) {
  if (e instanceof AuthError) {
    const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "NOT_FOUND" ? 404 : 403;
    return apiError(e.code, e.message, status);
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return apiError(
      "INVALID_REQUEST",
      first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request",
      422,
    );
  }
  // Only errors explicitly marked as user-facing are echoed back. Forwarding
  // any Error.message would leak Prisma internals — table names, and in
  // connection failures the database host and port — to API clients.
  if (e instanceof ValidationError) {
    return apiError("BAD_REQUEST", e.message, 400);
  }
  console.error("[api] unhandled", e);
  return apiError("INTERNAL", "Something went wrong.", 500);
}

/**
 * Wrap a handler with authentication + uniform error handling.
 *
 * Authorization is NOT decided here — handlers call the same
 * requirePermission/requireIssueAccess helpers the UI uses, so the API can
 * never be more permissive than the app.
 */
export function withApiAuth(
  handler: (ctx: AuthContext, req: Request, params: Record<string, string>) => Promise<Response>,
) {
  return async (req: Request, segmentData?: { params: Promise<Record<string, string>> }) =>
    // Everything below runs inside the API request scope, which is what permits
    // Bearer authentication. Server actions run outside it and stay cookie-only.
    runAsApiRequest(async () => {
    try {
      const ctx = await getAuthContext();
      if (!ctx) {
        return apiError(
          "UNAUTHENTICATED",
          "Provide a valid API token: Authorization: Bearer bt_…",
          401,
        );
      }

      // The API takes exactly one credential type. Rejecting cookie callers
      // keeps it immune to CSRF regardless of future cookie settings, and stops
      // a browser session from masking a token's narrower scopes during testing.
      if (ctx.via !== "token") {
        return apiError(
          "UNAUTHENTICATED",
          "The API requires an API token, not a browser session.",
          401,
        );
      }

      // Defence in depth: the scope clamp already lives in requireAuth, but a
      // future read-only handler must not be able to mutate by accident.
      const method = req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && !ctx.scopes.includes("write")) {
        return apiError("FORBIDDEN", "This API token is read-only.", 403);
      }

      // Per-token rate limit. The login throttle does not cover /api/v1, and
      // list endpoints are join-heavy enough to be worth bounding.
      const id = await getApiIdentity();
      if (id && !allowApiRequest(id.tokenId)) {
        return apiError("RATE_LIMITED", "Too many requests. Slow down.", 429);
      }

      const params = segmentData ? await segmentData.params : {};
      const res = await handler(ctx, req, params);

      // best-effort usage stamp, never blocks the response
      if (ctx.via === "token") {
        const id = await getApiIdentity();
        if (id) void touchToken(id.tokenId, id.lastUsedAt);
      }
      return res;
    } catch (e) {
      return toErrorResponse(e);
    }
    });
}

/** Parse a JSON body, rejecting anything that isn't a JSON object. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  return raw as Record<string, unknown>;
}

/** Clamp pagination to protect the database from unbounded queries. */
export function readPaging(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  return { limit, offset };
}
