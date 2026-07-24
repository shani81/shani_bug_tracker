import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

// Instant global search over issues (key + title + description).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ results: [] });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ results: [] });

  const issues = await prisma.issue.findMany({
    where: {
      deletedAt: null,
      project: { orgId: org.id },
      OR: [{ title: { contains: q } }, { key: { contains: q } }, { descMd: { contains: q } }],
    },
    select: { id: true, key: true, title: true, type: true, priority: true, project: { select: { key: true } } },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  return NextResponse.json({
    results: issues.map((i) => ({
      id: i.id,
      key: i.key,
      title: i.title,
      type: i.type,
      priority: i.priority,
      projectKey: i.project.key,
    })),
  });
}
