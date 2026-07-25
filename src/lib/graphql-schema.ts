import "server-only";
import { buildSchema } from "graphql";
import { listIssues, countIssues, getIssueDetail } from "@/lib/queries";
import { prisma } from "@/lib/prisma";
import {
  createIssue,
  updateIssue,
  changeStatus,
  addComment,
  softDeleteIssue,
  setAssignees,
  setLabels,
} from "@/lib/actions";
import { getUiCapabilities, type AuthContext } from "@/lib/permissions";
import type { IssueGroup } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL surface.
//
// Every resolver goes through the same queries and server actions as REST and
// the web app, so authorization, org scoping, activity logging, notifications
// and webhooks all behave identically. GraphQL is a second shape over one
// implementation, never a second set of rules.
// ─────────────────────────────────────────────────────────────────────────────

export const typeDefs = /* GraphQL */ `
  "A person in the organization."
  type User {
    id: ID!
    name: String!
    email: String!
    title: String
    color: String!
  }

  type Label {
    id: ID!
    name: String!
    color: String!
  }

  type Status {
    id: ID!
    name: String!
    category: String!
    color: String!
  }

  type Comment {
    id: ID!
    bodyMd: String!
    isPrivate: Boolean!
    author: User!
    createdAt: String!
  }

  type Project {
    id: ID!
    key: String!
    name: String!
    description: String
    icon: String!
    color: String!
    statuses: [Status!]!
    labels: [Label!]!
  }

  type Issue {
    id: ID!
    key: String!
    type: String!
    title: String!
    descMd: String!
    expected: String!
    actual: String!
    steps: String!
    url: String!
    priority: String!
    severity: String!
    impact: String!
    environment: String!
    storyPoints: Int
    status: Status!
    reporter: User!
    assignees: [User!]!
    labels: [Label!]!
    projectKey: String!
    componentName: String
    releaseVersion: String
    sprintName: String
    commentCount: Int!
    attachmentCount: Int!
    createdAt: String!
    updatedAt: String!
    resolvedAt: String
    "Only present on a single-issue query."
    comments: [Comment!]
  }

  type IssuePage {
    nodes: [Issue!]!
    total: Int!
    hasMore: Boolean!
  }

  type Viewer {
    id: ID!
    name: String!
    email: String!
    orgId: ID!
    orgRole: String!
    scopes: [String!]!
    capabilities: [String!]!
  }

  input IssueFilter {
    group: String
    projectId: ID
    statusId: ID
    priority: String
    severity: String
    assigneeId: ID
    labelId: ID
    search: String
    limit: Int
    offset: Int
  }

  input CreateIssueInput {
    projectId: ID!
    title: String!
    type: String
    descMd: String
    expected: String
    actual: String
    steps: String
    url: String
    priority: String
    severity: String
    impact: String
    environment: String
    statusId: ID
    assigneeIds: [ID!]
    labelIds: [ID!]
  }

  input UpdateIssueInput {
    title: String
    descMd: String
    expected: String
    actual: String
    steps: String
    url: String
    type: String
    priority: String
    severity: String
    impact: String
    environment: String
    storyPoints: Int
  }

  type Query {
    "Identity and effective permissions for the presented token."
    me: Viewer!
    projects: [Project!]!
    issues(filter: IssueFilter): IssuePage!
    "Returns null for an id outside your organization."
    issue(id: ID!): Issue
  }

  type Mutation {
    createIssue(input: CreateIssueInput!): Issue!
    updateIssue(id: ID!, input: UpdateIssueInput!): Issue!
    "Routed through the transition logic, so activity and timestamps are recorded."
    changeStatus(id: ID!, statusId: ID!): Issue!
    setAssignees(id: ID!, userIds: [ID!]!): Issue!
    setLabels(id: ID!, labelIds: [ID!]!): Issue!
    addComment(issueId: ID!, body: String!, isPrivate: Boolean): Comment!
    "Soft delete. Requires issue:delete."
    deleteIssue(id: ID!): Boolean!
  }
`;

export const schema = buildSchema(typeDefs);

const GROUPS = ["bug", "feature", "improvement", "task"];

type FilterArg = {
  group?: string | null;
  projectId?: string | null;
  statusId?: string | null;
  priority?: string | null;
  severity?: string | null;
  assigneeId?: string | null;
  labelId?: string | null;
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
};

function toFilter(f: FilterArg = {}) {
  const group = f.group && GROUPS.includes(f.group) ? (f.group as IssueGroup) : undefined;
  return {
    group,
    projectId: f.projectId ?? undefined,
    statusId: f.statusId ?? undefined,
    priority: f.priority ?? undefined,
    severity: f.severity ?? undefined,
    assigneeId: f.assigneeId ?? undefined,
    labelId: f.labelId ?? undefined,
    search: f.search ?? undefined,
  };
}

/** Re-fetch through the org-scoped query so a mutation can return the issue. */
async function issueOrThrow(id: string) {
  const issue = await getIssueDetail(id);
  if (!issue) throw new Error("Issue not found.");
  return issue;
}

/**
 * Root resolvers. `ctx` is the same AuthContext the REST layer uses; the
 * actions it calls perform their own capability and ownership checks.
 */
export function createRoot(ctx: AuthContext) {
  return {
    // ── Queries ───────────────────────────────────────────────────────────
    me: async () => ({
      id: ctx.userId,
      name: ctx.name,
      email: ctx.email,
      orgId: ctx.orgId,
      orgRole: ctx.orgRole,
      scopes: [...ctx.scopes],
      capabilities: await getUiCapabilities(),
    }),

    projects: async () => {
      const rows = await prisma.project.findMany({
        where: { orgId: ctx.orgId, isArchived: false },
        orderBy: { createdAt: "asc" },
        include: {
          statuses: { orderBy: { order: "asc" } },
          labels: { orderBy: { name: "asc" } },
        },
      });
      return rows.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        icon: p.icon,
        color: p.color,
        statuses: p.statuses.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          color: s.color,
        })),
        labels: p.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
      }));
    },

    issues: async ({ filter }: { filter?: FilterArg }) => {
      const base = toFilter(filter ?? {});
      const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 100);
      const offset = Math.max(filter?.offset ?? 0, 0);
      const [nodes, total] = await Promise.all([
        listIssues({ ...base, limit, offset }),
        countIssues(base),
      ]);
      return { nodes, total, hasMore: offset + nodes.length < total };
    },

    issue: async ({ id }: { id: string }) => getIssueDetail(id),

    // ── Mutations ─────────────────────────────────────────────────────────
    createIssue: async ({ input }: { input: Record<string, unknown> }) => {
      const created = await createIssue(input as Parameters<typeof createIssue>[0]);
      return issueOrThrow(created.id);
    },

    updateIssue: async ({ id, input }: { id: string; input: Record<string, unknown> }) => {
      await updateIssue(id, input);
      return issueOrThrow(id);
    },

    changeStatus: async ({ id, statusId }: { id: string; statusId: string }) => {
      await changeStatus(id, statusId);
      return issueOrThrow(id);
    },

    setAssignees: async ({ id, userIds }: { id: string; userIds: string[] }) => {
      await setAssignees(id, userIds);
      return issueOrThrow(id);
    },

    setLabels: async ({ id, labelIds }: { id: string; labelIds: string[] }) => {
      await setLabels(id, labelIds);
      return issueOrThrow(id);
    },

    addComment: async ({
      issueId,
      body,
      isPrivate,
    }: {
      issueId: string;
      body: string;
      isPrivate?: boolean;
    }) => {
      const { id } = await addComment(issueId, body, undefined, isPrivate === true);
      const issue = await issueOrThrow(issueId);
      const comment = issue.comments.find((c) => c.id === id);
      if (!comment) throw new Error("Comment not found after creation.");
      return { ...comment, bodyMd: comment.bodyMd };
    },

    deleteIssue: async ({ id }: { id: string }) => {
      await softDeleteIssue(id);
      return true;
    },
  };
}
