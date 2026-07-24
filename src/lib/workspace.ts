import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getActiveOrg, getCurrentUser } from "@/lib/session";
import { getAuthContext, getUiCapabilities } from "@/lib/permissions";
import { typeValuesForGroup, type IssueGroup } from "@/lib/constants";
import type { WorkspaceData, ProjectConfigDTO, UserDTO } from "@/lib/types";

const GROUPS: IssueGroup[] = ["bug", "feature", "improvement", "task"];

function toUserDTO(u: {
  id: string;
  name: string;
  email: string;
  color: string;
  avatarUrl: string | null;
  title: string | null;
}): UserDTO {
  return { id: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, title: u.title };
}

// Everything the client shell needs, in one serializable payload.
export const getWorkspaceData = cache(async (): Promise<WorkspaceData | null> => {
  const [org, currentUser, authCtx, capabilities] = await Promise.all([
    getActiveOrg(),
    getCurrentUser(),
    getAuthContext(),
    getUiCapabilities(),
  ]);
  // no session -> no workspace; the (app) layout redirects to /login
  if (!org || !currentUser || !authCtx) return null;

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: { orgId: org.id, isArchived: false },
      orderBy: { createdAt: "asc" },
      include: {
        statuses: { orderBy: { order: "asc" } },
        labels: { orderBy: { name: "asc" } },
        components: { orderBy: { name: "asc" } },
        releases: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.user.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" } }),
  ]);

  const projectDTOs: ProjectConfigDTO[] = projects.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    color: p.color,
    icon: p.icon,
    statuses: p.statuses.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      color: s.color,
      order: s.order,
    })),
    labels: p.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    components: p.components.map((c) => ({ id: c.id, name: c.name })),
    releases: p.releases.map((r) => ({ id: r.id, version: r.version })),
  }));

  // open-issue counts per module group (excludes done/canceled)
  const counts: Record<string, number> = {};
  await Promise.all(
    GROUPS.map(async (g) => {
      counts[g] = await prisma.issue.count({
        where: {
          deletedAt: null,
          project: { orgId: org.id },
          type: { in: typeValuesForGroup(g) },
          status: { category: { notIn: ["done", "canceled"] } },
        },
      });
    }),
  );

  const unread = await prisma.notification.count({
    where: { userId: currentUser.id, isRead: false },
  });

  // The roster is shipped to the client for assignee/avatar pickers, which need
  // names and colors but not addresses. Guests are external accounts, so don't
  // hand them a harvestable staff email directory.
  const hideEmails = authCtx.orgRole === "guest";

  return {
    orgName: org.name,
    orgColor: org.logoColor,
    currentUser: toUserDTO(currentUser),
    orgRole: authCtx.orgRole,
    capabilities,
    members: members.map((m) => {
      const dto = toUserDTO(m);
      return hideEmails && m.id !== currentUser.id ? { ...dto, email: "" } : dto;
    }),
    projects: projectDTOs,
    counts,
    unread,
  };
});
