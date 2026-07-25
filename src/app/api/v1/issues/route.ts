import { NextResponse } from "next/server";
import { withApiAuth, readJson, readPaging } from "@/lib/api-response";
import { listIssues, countIssues } from "@/lib/queries";
import { createIssue } from "@/lib/actions";
import type { IssueGroup } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GROUPS = ["bug", "feature", "improvement", "task"];

/**
 * GET /api/v1/issues
 *
 * Filters: group, projectId, statusId, priority, severity, assigneeId, labelId,
 * q, limit (max 100), offset.
 * Results are scoped to the token's organization by the query layer.
 */
export const GET = withApiAuth(async (_ctx, req) => {
  const url = new URL(req.url);
  const { limit, offset } = readPaging(url);
  const p = url.searchParams;

  const groupParam = p.get("group");
  const group = groupParam && GROUPS.includes(groupParam) ? (groupParam as IssueGroup) : undefined;

  const filter = {
    group,
    projectId: p.get("projectId") ?? undefined,
    statusId: p.get("statusId") ?? undefined,
    priority: p.get("priority") ?? undefined,
    severity: p.get("severity") ?? undefined,
    assigneeId: p.get("assigneeId") ?? undefined,
    labelId: p.get("labelId") ?? undefined,
    search: p.get("q") ?? undefined,
  };

  // limit/offset go into the query; total comes from a separate count, so
  // paging past the first page returns real rows instead of silently ending.
  const [data, total] = await Promise.all([
    listIssues({ ...filter, limit, offset }),
    countIssues(filter),
  ]);

  return NextResponse.json({
    data,
    pagination: { total, limit, offset, hasMore: offset + data.length < total },
  });
});

/**
 * POST /api/v1/issues — requires the "write" scope and issue:create.
 * Delegates to the same server action the UI uses, so validation, activity
 * logging, notifications and realtime events all behave identically.
 */
export const POST = withApiAuth(async (_ctx, req) => {
  const body = await readJson(req);
  const created = await createIssue(body as Parameters<typeof createIssue>[0]);
  return NextResponse.json({ data: created }, { status: 201 });
});
