import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-response";
import { getUiCapabilities } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/me
 *
 * Identity + effective permissions for the presented credential. Useful for
 * verifying a token and for a client to know what it may attempt.
 */
export const GET = withApiAuth(async (ctx) => {
  const capabilities = await getUiCapabilities();
  return NextResponse.json({
    data: {
      id: ctx.userId,
      name: ctx.name,
      email: ctx.email,
      orgId: ctx.orgId,
      orgRole: ctx.orgRole,
      authenticatedVia: ctx.via,
      scopes: ctx.scopes,
      // capabilities reflect the org role; writes additionally need the
      // "write" scope when authenticating with a token
      capabilities,
    },
  });
});
