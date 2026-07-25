import { NextResponse } from "next/server";
import { withApiAuth, readJson, apiError } from "@/lib/api-response";
import { getIssueDetail } from "@/lib/queries";
import { addComment } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/issues/:id/comments
 * Private (internal) comments are filtered by the query layer according to the
 * caller's role, so a guest token never receives them.
 */
export const GET = withApiAuth(async (_ctx, _req, params) => {
  const issue = await getIssueDetail(params.id);
  if (!issue) return apiError("NOT_FOUND", "Issue not found.", 404);
  return NextResponse.json({ data: issue.comments });
});

/** POST /api/v1/issues/:id/comments — body: { body, parentId?, isPrivate? } */
export const POST = withApiAuth(async (_ctx, req, params) => {
  const b = await readJson(req);
  const text = typeof b.body === "string" ? b.body : "";
  const created = await addComment(
    params.id,
    text,
    typeof b.parentId === "string" ? b.parentId : undefined,
    b.isPrivate === true,
  );
  return NextResponse.json({ data: created }, { status: 201 });
});
