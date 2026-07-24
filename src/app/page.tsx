import Link from "next/link";
import { Bug, CircleDot, Flame, CheckCircle2 } from "lucide-react";
import { getDashboardMetrics, listIssues } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { PageHeader, PageContainer } from "@/components/page-header";
import { TrendChart, BarList, Donut, StatTile } from "@/components/dashboard/charts";
import { TypeIcon, PriorityBadge, StatusPill } from "@/components/badges";
import { AvatarStack, Card } from "@/components/ui/primitives";
import { typeMeta, priorityMeta, categoryMeta } from "@/lib/constants";
import { relativeTime } from "@/lib/utils";

export default async function DashboardPage() {
  const [m, me] = await Promise.all([getDashboardMetrics(), getCurrentUser()]);
  const [recent, mine] = await Promise.all([
    listIssues({}),
    me ? listIssues({ assigneeId: me.id }) : Promise.resolve([]),
  ]);

  const myOpen = mine.filter((i) => !["done", "canceled"].includes(i.status.category)).slice(0, 6);
  const recentIssues = recent.slice(0, 7);

  const byType = m.byType
    .map((t) => ({ label: typeMeta(t.type).label, count: t.count, color: typeMeta(t.type).color, icon: typeMeta(t.type).icon }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
  const byPriority = m.byPriority
    .map((p) => ({ label: priorityMeta(p.priority).label, count: p.count, color: priorityMeta(p.priority).color }))
    .sort((a, b) => b.count - a.count);
  const byCategory = m.byCategory
    .map((c) => ({ label: categoryMeta(c.category).label, count: c.count, color: categoryMeta(c.category).color }))
    .sort((a, b) => b.count - a.count);

  const resolvedRate = m.total ? Math.round((m.done / m.total) * 100) : 0;

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome back, ${me?.name.split(" ")[0] ?? "there"}`}
        subtitle="Here's what's happening across your workspace."
      />

      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total issues" value={m.total} icon={<Bug size={18} />} accent="#5b5bd6" sub="all types" />
        <StatTile label="Open" value={m.open} icon={<CircleDot size={18} />} accent="#d97706" sub={`${resolvedRate}% resolved`} />
        <StatTile label="Critical open" value={m.critical} icon={<Flame size={18} />} accent="#dc2626" sub="needs attention" />
        <StatTile label="Resolved" value={m.done} icon={<CheckCircle2 size={18} />} accent="#16a34a" sub="done + closed" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* trend */}
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-[13.5px] font-semibold">Created vs Resolved · last 30 days</h2>
          <TrendChart created={m.created30} resolved={m.resolved30} />
        </Card>

        {/* status donut */}
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">By status</h2>
          <Donut items={byCategory} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">Issues by type</h2>
          <BarList items={byType} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">Issues by priority</h2>
          <BarList items={byPriority} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* assigned to me */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13.5px] font-semibold">Assigned to you</h2>
            <span className="text-[11.5px] text-faint">{myOpen.length} open</span>
          </div>
          <div className="space-y-1">
            {myOpen.map((i) => (
              <Link
                key={i.id}
                href={`/issue/${i.id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] hover:bg-surface-2"
              >
                <TypeIcon type={i.type} />
                <span className="font-mono text-[11px] text-faint">{i.key}</span>
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <PriorityBadge priority={i.priority} />
              </Link>
            ))}
            {myOpen.length === 0 && <p className="py-6 text-center text-[13px] text-muted">Nothing assigned. Nice.</p>}
          </div>
        </Card>

        {/* recent activity */}
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">Recently updated</h2>
          <div className="space-y-1">
            {recentIssues.map((i) => (
              <Link
                key={i.id}
                href={`/issue/${i.id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] hover:bg-surface-2"
              >
                <TypeIcon type={i.type} />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <span className="hidden sm:block">
                  <StatusPill status={i.status} />
                </span>
                <AvatarStack users={i.assignees} size={20} max={2} />
                <span className="hidden w-16 text-right text-[11px] text-faint md:block">{relativeTime(i.updatedAt)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
