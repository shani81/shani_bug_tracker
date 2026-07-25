import { NextResponse } from "next/server";
import { withApiAuth, readJson, apiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/permissions";
import { getIssueDetail } from "@/lib/queries";
import { updateIssue, changeStatus, setAssignees, setLabels, softDeleteIssue } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/issues/:id — org-scoped; a foreign id is a 404, not a 403. */
export const GET = withApiAuth(async (_ctx, _req, params) => {
  const issue = await getIssueDetail(params.id);
  if (!issue) return apiError("NOT_FOUND", "Issue not found.", 404);
  return NextResponse.json({ data: issue });
});

/**
 * PATCH /api/v1/issues/:id
 *
 * Accepts editable fields plus the relationship shortcuts statusId, assigneeIds
 * and labelIds. Each is routed to the action that owns that transition, so
 * status changes still record resolution timestamps and write an activity
 * entry rather than being a blind column write.
 */
export const PATCH = withApiAuth(async (_ctx, req, params) => {
  const body = await readJson(req);
  const { statusId, assigneeIds, labelIds, ...fields } = body;

  // An empty patch must not short-circuit into a 200 without any permission
  // check ever running.
  if (
    Object.keys(fields).length === 0 &&
    typeof statusId !== "string" &&
    !Array.isArray(assigneeIds) &&
    !Array.isArray(labelIds)
  ) {
    throw new ValidationError("No updatable fields supplied.");
  }

  if (Object.keys(fields).length > 0) {
    await updateIssue(params.id, fields);
  }
  if (typeof statusId === "string") {
    await changeStatus(params.id, statusId);
  }
  if (Array.isArray(assigneeIds)) {
    await setAssignees(params.id, assigneeIds.filter((x): x is string => typeof x === "string"));
  }
  if (Array.isArray(labelIds)) {
    await setLabels(params.id, labelIds.filter((x): x is string => typeof x === "string"));
  }

  const issue = await getIssueDetail(params.id);
  if (!issue) return apiError("NOT_FOUND", "Issue not found.", 404);
  return NextResponse.json({ data: issue });
});

/** DELETE /api/v1/issues/:id — soft delete; requires issue:delete. */
export const DELETE = withApiAuth(async (_ctx, _req, params) => {
  await softDeleteIssue(params.id);
  return NextResponse.json({ data: { id: params.id, deleted: true } });
});
