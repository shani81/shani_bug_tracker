import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getActiveOrg, getCurrentUser } from "@/lib/session";
import { getAuthContext } from "@/lib/permissions";
import { formatKey } from "@/lib/utils";
import { typeValuesForGroup, type IssueGroup } from "@/lib/constants";
import type {
  IssueDTO,
  IssueDetailDTO,
  UserDTO,
  LabelDTO,
  StatusDTO,
  CommentDTO,
  AttachmentDTO,
  ActivityDTO,
  TimeLogDTO,
} from "@/lib/types";

// Shared include shape for issues + their relations.
export const issueInclude = {
  status: true,
  reporter: true,
  project: true,
  component: true,
  release: true,
  sprint: true,
  assignees: { include: { user: true } },
  labels: { include: { label: true } },
  _count: { select: { comments: true, attachments: true, watchers: true } },
} satisfies Prisma.IssueInclude;

type IssueWithRelations = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;

function userDTO(u: {
  id: string;
  name: string;
  email: string;
  color: string;
  avatarUrl: string | null;
  title: string | null;
}): UserDTO {
  return { id: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, title: u.title };
}

export function serializeIssue(i: IssueWithRelations): IssueDTO {
  const status: StatusDTO = {
    id: i.status.id,
    name: i.status.name,
    category: i.status.category,
    color: i.status.color,
    order: i.status.order,
  };
  const labels: LabelDTO[] = i.labels.map((l) => ({
    id: l.label.id,
    name: l.label.name,
    color: l.label.color,
  }));
  return {
    id: i.id,
    key: i.key || formatKey(i.project.key, i.number),
    number: i.number,
    projectId: i.projectId,
    projectKey: i.project.key,
    projectName: i.project.name,
    type: i.type,
    title: i.title,
    descMd: i.descMd,
    expected: i.expected,
    actual: i.actual,
    steps: i.steps,
    url: i.url,
    priority: i.priority,
    severity: i.severity,
    impact: i.impact,
    environment: i.environment,
    status,
    reporter: userDTO(i.reporter),
    assignees: i.assignees.map((a) => userDTO(a.user)),
    labels,
    componentName: i.component?.name ?? null,
    releaseVersion: i.release?.version ?? null,
    sprintName: i.sprint?.name ?? null,
    storyPoints: i.storyPoints,
    estimateMin: i.estimateMin,
    dueDate: i.dueDate?.toISOString() ?? null,
    boardOrder: i.boardOrder,
    commentCount: i._count.comments,
    attachmentCount: i._count.attachments,
    watcherCount: i._count.watchers,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
  };
}

// ── Workspace ────────────────────────────────────────────────────────────────

export const getWorkspace = cache(async () => {
  const org = await getActiveOrg();
  if (!org) return null;
  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: { orgId: org.id, isArchived: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" } }),
  ]);
  return { org, projects, members };
});

// ── Issue listing ────────────────────────────────────────────────────────────

export type IssueFilter = {
  group?: IssueGroup;
  projectId?: string;
  statusCategory?: string;
  statusId?: string;
  priority?: string;
  severity?: string;
  type?: string;
  assigneeId?: string;
  reporterId?: string;
  labelId?: string;
  releaseId?: string;
  search?: string;
  includeDone?: boolean;
  /** pagination — pushed into the query, not applied after fetching */
  limit?: number;
  offset?: number;
};

/** Total matching rows for a filter, for API pagination metadata. */
export async function countIssues(filter: IssueFilter = {}): Promise<number> {
  const org = await getActiveOrg();
  if (!org) return 0;
  return prisma.issue.count({ where: buildIssueWhere(filter, org.id) });
}

function buildIssueWhere(filter: IssueFilter, orgId: string): Record<string, unknown> {
  const where: Record<string, unknown> = {
    deletedAt: null,
    project: { orgId },
  };

  if (filter.group) where.type = { in: typeValuesForGroup(filter.group) };
  if (filter.type) where.type = filter.type;
  if (filter.projectId) where.projectId = filter.projectId;
  if (filter.priority) where.priority = filter.priority;
  if (filter.severity) where.severity = filter.severity;
  if (filter.statusId) where.statusId = filter.statusId;
  if (filter.reporterId) where.reporterId = filter.reporterId;
  if (filter.releaseId) where.releaseId = filter.releaseId;
  if (filter.statusCategory) where.status = { category: filter.statusCategory };
  if (filter.assigneeId) where.assignees = { some: { userId: filter.assigneeId } };
  if (filter.labelId) where.labels = { some: { labelId: filter.labelId } };
  if (filter.search) {
    // cap length and neutralise LIKE wildcards — "%" would otherwise match
    // every row and turn search into a full-table scan
    const q = filter.search.slice(0, 200).replace(/[%_]/g, "");
    where.OR = [
      { title: { contains: q } },
      { descMd: { contains: q } },
      { key: { contains: q } },
    ];
  }
  return where;
}

export async function listIssues(filter: IssueFilter = {}): Promise<IssueDTO[]> {
  const org = await getActiveOrg();
  if (!org) return [];

  const issues = await prisma.issue.findMany({
    where: buildIssueWhere(filter, org.id),
    include: issueInclude,
    orderBy: [{ updatedAt: "desc" }],
    skip: filter.offset ?? 0,
    take: Math.min(filter.limit ?? 500, 500),
  });
  return issues.map(serializeIssue);
}

export async function getIssueById(id: string): Promise<IssueDTO | null> {
  const org = await getActiveOrg();
  if (!org) return null;
  // scoped by org so an id from another tenant resolves to null
  const issue = await prisma.issue.findFirst({
    where: { id, deletedAt: null, project: { orgId: org.id } },
    include: issueInclude,
  });
  return issue ? serializeIssue(issue) : null;
}

export async function getIssueByKey(key: string): Promise<IssueDTO | null> {
  const org = await getActiveOrg();
  if (!org) return null;
  const issue = await prisma.issue.findFirst({
    where: { key, deletedAt: null, project: { orgId: org.id } },
    include: issueInclude,
  });
  return issue ? serializeIssue(issue) : null;
}

export async function getIssueDetail(id: string): Promise<IssueDetailDTO | null> {
  const org = await getActiveOrg();
  if (!org) return null;
  const [issue, current] = await Promise.all([
    prisma.issue.findFirst({
      where: { id, deletedAt: null, project: { orgId: org.id } },
      include: {
        ...issueInclude,
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
        attachments: { orderBy: { createdAt: "asc" } },
        activities: { include: { actor: true }, orderBy: { createdAt: "desc" }, take: 40 },
        timeLogs: { include: { user: true }, orderBy: { spentAt: "desc" } },
        watchers: { select: { userId: true } },
      },
    }),
    getCurrentUser(),
  ]);
  if (!issue) return null;

  const base = serializeIssue(issue);
  const u = (x: {
    id: string;
    name: string;
    email: string;
    color: string;
    avatarUrl: string | null;
    title: string | null;
  }): UserDTO => ({ id: x.id, name: x.name, email: x.email, color: x.color, avatarUrl: x.avatarUrl, title: x.title });

  // Private comments are internal staff notes. Guests (customer-facing
  // accounts) must never receive them — filtering must happen here, not in the
  // UI, or the bodies still ship in the RSC payload.
  const authCtx = await getAuthContext();
  const seesPrivate = authCtx ? authCtx.orgRole !== "guest" : false;

  const comments: CommentDTO[] = issue.comments
    .filter((c) => !c.deletedAt)
    .filter((c) => !c.isPrivate || seesPrivate || c.authorId === current?.id)
    .map((c) => ({
      id: c.id,
      author: u(c.author),
      bodyMd: c.bodyMd,
      isPinned: c.isPinned,
      isPrivate: c.isPrivate,
      parentId: c.parentId,
      editedAt: c.editedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }));

  const attachments: AttachmentDTO[] = issue.attachments.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    url: a.url,
    sizeBytes: a.sizeBytes,
    mimeType: a.mimeType,
    createdAt: a.createdAt.toISOString(),
  }));

  const activities: ActivityDTO[] = issue.activities.map((a) => ({
    id: a.id,
    actor: a.actor ? u(a.actor) : null,
    verb: a.verb,
    field: a.field,
    fromVal: a.fromVal,
    toVal: a.toVal,
    createdAt: a.createdAt.toISOString(),
  }));

  const timeLogs: TimeLogDTO[] = issue.timeLogs.map((t) => ({
    id: t.id,
    user: t.user ? u(t.user) : null,
    minutes: t.minutes,
    note: t.note,
    spentAt: t.spentAt.toISOString(),
  }));

  return {
    ...base,
    comments,
    attachments,
    activities,
    timeLogs,
    reporterId: issue.reporterId,
    contextJson: issue.contextJson,
    browser: issue.browser,
    os: issue.os,
    device: issue.device,
    appVersion: issue.appVersion,
    gitCommit: issue.gitCommit,
    watching: current ? issue.watchers.some((w) => w.userId === current.id) : false,
  };
}

// ── Dashboard / analytics metrics ────────────────────────────────────────────

export const getDashboardMetrics = cache(async () => {
  const org = await getActiveOrg();
  if (!org) {
    return {
      total: 0,
      open: 0,
      done: 0,
      critical: 0,
      byType: [] as { type: string; count: number }[],
      byPriority: [] as { priority: string; count: number }[],
      byCategory: [] as { category: string; count: number }[],
      created30: [] as { date: string; count: number }[],
      resolved30: [] as { date: string; count: number }[],
    };
  }

  const issues = await prisma.issue.findMany({
    where: { deletedAt: null, project: { orgId: org.id } },
    include: { status: true },
  });

  const total = issues.length;
  const done = issues.filter((i) => ["done", "canceled"].includes(i.status.category)).length;
  const open = total - done;
  const critical = issues.filter(
    (i) => i.priority === "critical" && !["done", "canceled"].includes(i.status.category),
  ).length;

  const count = <T extends string>(list: string[]) => {
    const m = new Map<string, number>();
    for (const v of list) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => ({ key: k as T, count: v }));
  };

  const byType = count(issues.map((i) => i.type)).map((x) => ({ type: x.key, count: x.count }));
  const byPriority = count(issues.map((i) => i.priority)).map((x) => ({ priority: x.key, count: x.count }));
  const byCategory = count(issues.map((i) => i.status.category)).map((x) => ({
    category: x.key,
    count: x.count,
  }));

  // 30-day created / resolved trend
  const days: string[] = [];
  const today = new Date();
  for (let d = 29; d >= 0; d--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - d);
    days.push(dt.toISOString().slice(0, 10));
  }
  const createdMap = new Map(days.map((d) => [d, 0]));
  const resolvedMap = new Map(days.map((d) => [d, 0]));
  for (const i of issues) {
    const c = i.createdAt.toISOString().slice(0, 10);
    if (createdMap.has(c)) createdMap.set(c, (createdMap.get(c) ?? 0) + 1);
    if (i.resolvedAt) {
      const r = i.resolvedAt.toISOString().slice(0, 10);
      if (resolvedMap.has(r)) resolvedMap.set(r, (resolvedMap.get(r) ?? 0) + 1);
    }
  }

  return {
    total,
    open,
    done,
    critical,
    byType,
    byPriority,
    byCategory,
    created30: days.map((d) => ({ date: d, count: createdMap.get(d) ?? 0 })),
    resolved30: days.map((d) => ({ date: d, count: resolvedMap.get(d) ?? 0 })),
  };
});
