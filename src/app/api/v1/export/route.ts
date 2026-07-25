import { NextResponse } from "next/server";
import { withApiAuth, readPaging } from "@/lib/api-response";
import { listIssues } from "@/lib/queries";
import { toCsv } from "@/lib/csv";
import type { IssueGroup } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GROUPS = ["bug", "feature", "improvement", "task"];

const COLUMNS = [
  "key",
  "type",
  "title",
  "status",
  "statusCategory",
  "priority",
  "severity",
  "impact",
  "environment",
  "project",
  "component",
  "release",
  "sprint",
  "reporter",
  "assignees",
  "labels",
  "storyPoints",
  "commentCount",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "url",
  "description",
] as const;

/**
 * GET /api/v1/export?format=csv|json
 *
 * Exports the caller's issues, honouring the same filters as /api/v1/issues.
 * Read scope is enough — this is a read endpoint.
 */
export const GET = withApiAuth(async (_ctx, req) => {
  const url = new URL(req.url);
  const p = url.searchParams;
  const format = (p.get("format") ?? "csv").toLowerCase();

  const groupParam = p.get("group");
  const group = groupParam && GROUPS.includes(groupParam) ? (groupParam as IssueGroup) : undefined;

  // Exports are bounded like every other query; page with offset for more.
  const { limit, offset } = readPaging(url);
  const issues = await listIssues({
    group,
    projectId: p.get("projectId") ?? undefined,
    statusId: p.get("statusId") ?? undefined,
    priority: p.get("priority") ?? undefined,
    severity: p.get("severity") ?? undefined,
    assigneeId: p.get("assigneeId") ?? undefined,
    labelId: p.get("labelId") ?? undefined,
    search: p.get("q") ?? undefined,
    limit: Math.max(limit, 500),
    offset,
  });

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), issues }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="issues-${stamp}.json"`,
      },
    });
  }

  const rows = issues.map((i) => ({
    key: i.key,
    type: i.type,
    title: i.title,
    status: i.status.name,
    statusCategory: i.status.category,
    priority: i.priority,
    severity: i.severity,
    impact: i.impact,
    environment: i.environment,
    project: i.projectKey,
    component: i.componentName ?? "",
    release: i.releaseVersion ?? "",
    sprint: i.sprintName ?? "",
    reporter: i.reporter.email,
    assignees: i.assignees.map((a) => a.email).join(" "),
    labels: i.labels.map((l) => l.name).join(" "),
    storyPoints: i.storyPoints ?? "",
    commentCount: i.commentCount,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    resolvedAt: i.resolvedAt ?? "",
    url: i.url,
    description: i.descMd,
  }));

  // BOM so Excel reads UTF-8 correctly
  return new NextResponse("﻿" + toCsv(rows, [...COLUMNS]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="issues-${stamp}.csv"`,
    },
  });
});
