import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getActiveOrg, getCurrentUser } from "@/lib/session";
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
  const org = await getActiveOrg();
  const currentUser = await getCurrentUser();
  if (!org) return null;

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

  const unread = currentUser
    ? await prisma.notification.count({ where: { userId: currentUser.id, isRead: false } })
    : 0;

  return {
    orgName: org.name,
    orgColor: org.logoColor,
    currentUser: currentUser ? toUserDTO(currentUser) : null,
    members: members.map(toUserDTO),
    projects: projectDTOs,
    counts,
    unread,
  };
});
