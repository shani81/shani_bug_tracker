import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/projects
 *
 * Returns the caller's projects with the ids needed to create issues against
 * them (statuses, labels, components) — otherwise a client has no way to
 * discover a valid statusId.
 */
export const GET = withApiAuth(async (ctx) => {
  const projects = await prisma.project.findMany({
    where: { orgId: ctx.orgId, isArchived: false },
    orderBy: { createdAt: "asc" },
    include: {
      statuses: { orderBy: { order: "asc" } },
      labels: { orderBy: { name: "asc" } },
      components: { orderBy: { name: "asc" } },
    },
  });

  return NextResponse.json({
    data: projects.map((p) => ({
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
        isDefault: s.isDefault,
      })),
      labels: p.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
      components: p.components.map((c) => ({ id: c.id, name: c.name })),
    })),
  });
});
