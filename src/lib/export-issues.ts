import "server-only";
import { listIssues } from "@/lib/queries";
import { toCsv } from "@/lib/csv";
import type { IssueGroup } from "@/lib/constants";

// Shared by the token-authenticated /api/v1/export and the cookie-authenticated
// /api/export the UI download links use, so both produce identical output.

export const EXPORT_COLUMNS = [
  "key", "type", "title", "status", "statusCategory", "priority", "severity",
  "impact", "environment", "project", "component", "release", "sprint",
  "reporter", "assignees", "labels", "storyPoints", "commentCount",
  "createdAt", "updatedAt", "resolvedAt", "url", "description",
] as const;

const GROUPS = ["bug", "feature", "improvement", "task"];

export async function buildExport(params: URLSearchParams, limit: number, offset: number) {
  const groupParam = params.get("group");
  const group = groupParam && GROUPS.includes(groupParam) ? (groupParam as IssueGroup) : undefined;

  const issues = await listIssues({
    group,
    projectId: params.get("projectId") ?? undefined,
    statusId: params.get("statusId") ?? undefined,
    priority: params.get("priority") ?? undefined,
    severity: params.get("severity") ?? undefined,
    assigneeId: params.get("assigneeId") ?? undefined,
    labelId: params.get("labelId") ?? undefined,
    search: params.get("q") ?? undefined,
    limit,
    offset,
  });

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

  return { issues, rows };
}

export function csvResponseBody(rows: Record<string, unknown>[]) {
  // BOM so Excel reads UTF-8 correctly
  return "﻿" + toCsv(rows, [...EXPORT_COLUMNS]);
}

export function exportFilename(format: string) {
  return `issues-${new Date().toISOString().slice(0, 10)}.${format}`;
}
