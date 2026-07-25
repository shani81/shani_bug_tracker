import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getActiveOrg, getCurrentUser } from "@/lib/session";
import { getAuthContext } from "@/lib/permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Read-side data access for the secondary modules (releases, sprints, QA,
// analytics, notifications, settings, roadmap). All return plain serializable
// objects (dates as ISO strings) safe to pass into client components.
// ─────────────────────────────────────────────────────────────────────────────

async function orgId() {
  const org = await getActiveOrg();
  return org?.id ?? "__none__";
}

// ── Releases ─────────────────────────────────────────────────────────────────

export type ReleaseData = {
  id: string;
  version: string;
  name: string;
  description: string;
  status: string;
  projectKey: string;
  projectName: string;
  releaseDate: string | null;
  total: number;
  fixed: number; // issues resolved/done in this release
  open: number;
};

export const getReleases = cache(async (): Promise<ReleaseData[]> => {
  const releases = await prisma.release.findMany({
    where: { project: { orgId: await orgId() } },
    include: {
      project: true,
      issues: { where: { deletedAt: null }, include: { status: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  return releases.map((r) => {
    const fixed = r.issues.filter((i) => ["done"].includes(i.status.category)).length;
    return {
      id: r.id,
      version: r.version,
      name: r.name,
      description: r.description,
      status: r.status,
      projectKey: r.project.key,
      projectName: r.project.name,
      releaseDate: r.releaseDate?.toISOString() ?? null,
      total: r.issues.length,
      fixed,
      open: r.issues.length - fixed,
    };
  });
});

// ── Sprints ──────────────────────────────────────────────────────────────────

export type SprintData = {
  id: string;
  name: string;
  goal: string;
  status: string;
  projectKey: string;
  startDate: string | null;
  endDate: string | null;
  total: number;
  done: number;
  points: number;
  donePoints: number;
};

export const getSprints = cache(async (): Promise<SprintData[]> => {
  const sprints = await prisma.sprint.findMany({
    where: { project: { orgId: await orgId() } },
    include: {
      project: true,
      issues: { where: { deletedAt: null }, include: { status: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  return sprints.map((s) => {
    const done = s.issues.filter((i) => i.status.category === "done").length;
    const points = s.issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const donePoints = s.issues
      .filter((i) => i.status.category === "done")
      .reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      goal: s.goal,
      status: s.status,
      projectKey: s.project.key,
      startDate: s.startDate?.toISOString() ?? null,
      endDate: s.endDate?.toISOString() ?? null,
      total: s.issues.length,
      done,
      points,
      donePoints,
    };
  });
});

// ── QA ───────────────────────────────────────────────────────────────────────

export type TestCaseData = {
  id: string;
  title: string;
  kind: string;
  priority: string;
  precondition: string;
  steps: string;
  expected: string;
  latestStatus: string; // pass | fail | blocked | retest | untested
};

export type TestPlanData = {
  id: string;
  name: string;
  description: string;
  projectKey: string;
  cases: TestCaseData[];
  summary: Record<string, number>; // status -> count
};

export const getTestPlans = cache(async (): Promise<TestPlanData[]> => {
  const plans = await prisma.testPlan.findMany({
    where: { project: { orgId: await orgId() } },
    include: {
      project: true,
      cases: { include: { results: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return plans.map((p) => {
    const cases: TestCaseData[] = p.cases.map((c) => ({
      id: c.id,
      title: c.title,
      kind: c.kind,
      priority: c.priority,
      precondition: c.precondition,
      steps: c.steps,
      expected: c.expected,
      latestStatus: c.results[0]?.status ?? "untested",
    }));
    const summary: Record<string, number> = {};
    for (const c of cases) summary[c.latestStatus] = (summary[c.latestStatus] ?? 0) + 1;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      projectKey: p.project.key,
      cases,
      summary,
    };
  });
});

// ── Notifications ────────────────────────────────────────────────────────────

export type NotificationData = {
  id: string;
  title: string;
  body: string;
  kind: string;
  issueId: string | null;
  isRead: boolean;
  createdAt: string;
};

export const getNotifications = cache(async (): Promise<NotificationData[]> => {
  const me = await getCurrentUser();
  if (!me) return [];
  const notifs = await prisma.notification.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return notifs.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    kind: n.kind,
    issueId: n.issueId,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  }));
});

// ── Analytics (extended) ─────────────────────────────────────────────────────

export type AnalyticsData = {
  total: number;
  open: number;
  done: number;
  critical: number;
  avgResolutionHours: number;
  reopenRate: number;
  byProject: { name: string; total: number; open: number; done: number }[];
  byAssignee: { name: string; color: string; assigned: number; resolved: number }[];
  byComponent: { name: string; count: number }[];
  byType: { type: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  byCategory: { category: string; count: number }[];
  created30: { date: string; count: number }[];
  resolved30: { date: string; count: number }[];
};

export const getAnalytics = cache(async (): Promise<AnalyticsData> => {
  const oid = await orgId();
  const issues = await prisma.issue.findMany({
    where: { deletedAt: null, project: { orgId: oid } },
    include: {
      status: true,
      project: true,
      component: true,
      assignees: { include: { user: true } },
    },
  });

  const total = issues.length;
  const done = issues.filter((i) => ["done", "canceled"].includes(i.status.category)).length;
  const open = total - done;
  const critical = issues.filter(
    (i) => i.priority === "critical" && !["done", "canceled"].includes(i.status.category),
  ).length;

  const resolved = issues.filter((i) => i.resolvedAt);
  const avgResolutionHours = resolved.length
    ? Math.round(
        resolved.reduce((a, i) => a + (i.resolvedAt!.getTime() - i.createdAt.getTime()) / 3600_000, 0) /
          resolved.length,
      )
    : 0;

  // by project
  const projMap = new Map<string, { name: string; total: number; open: number; done: number }>();
  for (const i of issues) {
    const cur = projMap.get(i.projectId) ?? { name: i.project.name, total: 0, open: 0, done: 0 };
    cur.total++;
    if (["done", "canceled"].includes(i.status.category)) cur.done++;
    else cur.open++;
    projMap.set(i.projectId, cur);
  }

  // by assignee
  const asgMap = new Map<string, { name: string; color: string; assigned: number; resolved: number }>();
  for (const i of issues) {
    for (const a of i.assignees) {
      const cur = asgMap.get(a.userId) ?? { name: a.user.name, color: a.user.color, assigned: 0, resolved: 0 };
      cur.assigned++;
      if (["done", "canceled"].includes(i.status.category)) cur.resolved++;
      asgMap.set(a.userId, cur);
    }
  }

  // by component
  const compMap = new Map<string, number>();
  for (const i of issues) {
    if (i.component) compMap.set(i.component.name, (compMap.get(i.component.name) ?? 0) + 1);
  }

  const tally = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()];
  };

  // 30-day trend
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
    avgResolutionHours,
    reopenRate: 0,
    byProject: [...projMap.values()].sort((a, b) => b.total - a.total),
    byAssignee: [...asgMap.values()].sort((a, b) => b.assigned - a.assigned),
    byComponent: [...compMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    byType: tally(issues.map((i) => i.type)).map(([type, count]) => ({ type, count })),
    byPriority: tally(issues.map((i) => i.priority)).map(([priority, count]) => ({ priority, count })),
    byCategory: tally(issues.map((i) => i.status.category)).map(([category, count]) => ({ category, count })),
    created30: days.map((d) => ({ date: d, count: createdMap.get(d) ?? 0 })),
    resolved30: days.map((d) => ({ date: d, count: resolvedMap.get(d) ?? 0 })),
  };
});

// ── Settings ─────────────────────────────────────────────────────────────────

export type SettingsData = {
  projects: {
    id: string;
    key: string;
    name: string;
    icon: string;
    color: string;
    statuses: { id: string; name: string; category: string; color: string; isDefault: boolean }[];
    labels: { id: string; name: string; color: string }[];
    components: { id: string; name: string }[];
    automations: { id: string; name: string; trigger: string; isEnabled: boolean; runCount: number }[];
  }[];
  members: {
    id: string;
    name: string;
    email: string;
    color: string;
    title: string | null;
    role: string;
    isActive: boolean;
    isSelf: boolean;
  }[];
  invitations: { id: string; email: string; role: string; invitedBy: string; expiresAt: string }[];
  webhooks: {
    id: string;
    name: string;
    url: string;
    events: string[];
    isEnabled: boolean;
    projectName: string | null;
    lastStatus: number | null;
    lastError: string | null;
    lastFiredAt: string | null;
  }[];
  /** the CALLER's own API tokens — never anyone else's */
  apiTokens: {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  }[];
  /** org roles the viewer is allowed to grant — drives the role picker */
  grantableRoles: string[];
  viewerRole: string;
};

export const getSettings = cache(async (): Promise<SettingsData> => {
  const [org, ctx] = await Promise.all([getActiveOrg(), getAuthContext()]);
  if (!org || !ctx) {
    return {
      projects: [], members: [], invitations: [], apiTokens: [], webhooks: [],
      grantableRoles: [], viewerRole: "",
    };
  }
  const [projects, memberships, invitations, apiTokens, webhooks] = await Promise.all([
    prisma.project.findMany({
      where: { orgId: org.id },
      include: {
        statuses: { orderBy: { order: "asc" } },
        labels: { orderBy: { name: "asc" } },
        components: { orderBy: { name: "asc" } },
        automations: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.membership.findMany({
      where: { orgId: org.id },
      // explicit select: never pull passwordHash into render scope
      select: {
        role: true,
        isActive: true,
        user: { select: { id: true, name: true, email: true, color: true, title: true } },
      },
    }),
    prisma.invitation.findMany({
      where: { orgId: org.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.apiToken.findMany({
      where: { userId: ctx.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.webhook.findMany({
      where: { orgId: org.id },
      // never select `secret` — it must not reach the client
      select: {
        id: true, name: true, url: true, events: true, isEnabled: true,
        lastStatus: true, lastError: true, lastFiredAt: true,
        project: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // an admin may not grant or modify roles at or above their own
  const grantable =
    ctx.orgRole === "owner"
      ? ["owner", "admin", "member", "guest"]
      : ctx.orgRole === "admin"
        ? ["member", "guest"]
        : [];

  return {
    projects: projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      icon: p.icon,
      color: p.color,
      statuses: p.statuses.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        color: s.color,
        isDefault: s.isDefault,
      })),
      labels: p.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
      components: p.components.map((c) => ({ id: c.id, name: c.name })),
      automations: p.automations.map((a) => ({
        id: a.id,
        name: a.name,
        trigger: a.trigger,
        isEnabled: a.isEnabled,
        runCount: a.runCount,
      })),
    })),
    members: memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      color: m.user.color,
      title: m.user.title,
      role: m.role,
      isActive: m.isActive,
      isSelf: m.user.id === ctx.userId,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy.name,
      expiresAt: i.expiresAt.toISOString(),
    })),
    apiTokens: apiTokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes.split(",").filter(Boolean),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    webhooks: webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events.split(",").filter(Boolean),
      isEnabled: w.isEnabled,
      projectName: w.project?.name ?? null,
      lastStatus: w.lastStatus,
      lastError: w.lastError,
      lastFiredAt: w.lastFiredAt?.toISOString() ?? null,
    })),
    grantableRoles: grantable,
    viewerRole: ctx.orgRole,
  };
});
