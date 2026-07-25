import { NextResponse } from "next/server";
import { graphql, type GraphQLFormattedError } from "graphql";
import { schema, createRoot } from "@/lib/graphql-schema";
import { getAuthContext, AuthError, ValidationError } from "@/lib/permissions";
import { runAsApiRequest } from "@/lib/request-context";
import { getApiIdentity, touchToken } from "@/lib/api-auth";
import { allowApiRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_QUERY_CHARS = 10_000;
/** Rough nesting guard — GraphQL's flexibility is also a DoS surface. */
const MAX_DEPTH = 12;

function depthOf(query: string): number {
  let depth = 0;
  let max = 0;
  for (const c of query) {
    if (c === "{") max = Math.max(max, ++depth);
    else if (c === "}") depth--;
  }
  return max;
}

/**
 * POST /api/graphql
 *
 * Same credential and the same authorization as the REST API — resolvers call
 * the very same queries and server actions, so this cannot be a softer way in.
 */
export async function POST(req: Request) {
  return runAsApiRequest(async () => {
    try {
      const ctx = await getAuthContext();
      if (!ctx) {
        return NextResponse.json(
          { errors: [{ message: "Provide a valid API token: Authorization: Bearer bt_…" }] },
          { status: 401 },
        );
      }
      // One credential type, as with REST: a browser session is not accepted.
      if (ctx.via !== "token") {
        return NextResponse.json(
          { errors: [{ message: "The API requires an API token, not a browser session." }] },
          { status: 401 },
        );
      }

      const identity = await getApiIdentity();
      if (identity && !allowApiRequest(identity.tokenId)) {
        return NextResponse.json({ errors: [{ message: "Too many requests." }] }, { status: 429 });
      }

      let body: { query?: unknown; variables?: unknown; operationName?: unknown };
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ errors: [{ message: "Body must be JSON." }] }, { status: 400 });
      }

      const query = typeof body.query === "string" ? body.query : "";
      if (!query) {
        return NextResponse.json({ errors: [{ message: "No query supplied." }] }, { status: 400 });
      }
      if (query.length > MAX_QUERY_CHARS) {
        return NextResponse.json({ errors: [{ message: "Query is too large." }] }, { status: 413 });
      }
      if (depthOf(query) > MAX_DEPTH) {
        return NextResponse.json({ errors: [{ message: "Query is nested too deeply." }] }, { status: 400 });
      }

      const result = await graphql({
        schema,
        source: query,
        rootValue: createRoot(ctx),
        variableValues: (body.variables ?? {}) as Record<string, unknown>,
        operationName: typeof body.operationName === "string" ? body.operationName : undefined,
      });

      if (identity) void touchToken(identity.tokenId, identity.lastUsedAt);

      // Resolver failures arrive as GraphQL errors; scrub anything that isn't
      // one of ours so Prisma internals never reach the client.
      const errors = result.errors?.map((e): GraphQLFormattedError => {
        const original = e.originalError;
        const safe = original instanceof AuthError || original instanceof ValidationError;
        if (!safe && original) console.error("[graphql]", original);
        return {
          message: safe || !original ? e.message : "Something went wrong.",
          path: e.path,
        };
      });

      return NextResponse.json(
        { data: result.data ?? null, ...(errors?.length ? { errors } : {}) },
        // GraphQL reports its own errors in the body; the transport stays 200
        // unless the request itself was rejected above.
        { status: 200 },
      );
    } catch (e) {
      console.error("[graphql] unhandled", e);
      return NextResponse.json({ errors: [{ message: "Something went wrong." }] }, { status: 500 });
    }
  });
}

/** A GET returns the SDL, so clients can introspect without a POST. */
export async function GET() {
  const ctx = await runAsApiRequest(async () => getAuthContext());
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { typeDefs } = await import("@/lib/graphql-schema");
  return new NextResponse(typeDefs, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
