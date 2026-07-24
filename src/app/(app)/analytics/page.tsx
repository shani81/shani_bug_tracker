import { Layers, CircleDot, Timer, Flame } from "lucide-react";
import { getAnalytics } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { TrendChart, BarList, Donut, StatTile } from "@/components/dashboard/charts";
import { Avatar, Card } from "@/components/ui/primitives";
import { typeMeta, priorityMeta, categoryMeta } from "@/lib/constants";
import { colorFromString } from "@/lib/utils";

export default async function AnalyticsPage() {
  const a = await getAnalytics();

  const resolvedRate = a.total ? Math.round((a.done / a.total) * 100) : 0;
  const avgResolution =
    a.avgResolutionHours >= 24
      ? `${Math.round(a.avgResolutionHours / 24)}d`
      : `${a.avgResolutionHours}h`;

  const byType = a.byType
    .map((t) => {
      const m = typeMeta(t.type);
      return { label: m.label, count: t.count, color: m.color, icon: m.icon };
    })
    .sort((x, y) => y.count - x.count)
    .slice(0, 8);

  const byPriority = a.byPriority
    .map((p) => {
      const m = priorityMeta(p.priority);
      return { label: m.label, count: p.count, color: m.color, icon: m.icon };
    })
    .sort((x, y) => y.count - x.count);

  const byComponent = a.byComponent
    .map((c) => ({ label: c.name, count: c.count, color: colorFromString(c.name) }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 8);

  const byCategory = a.byCategory
    .map((c) => {
      const m = categoryMeta(c.category);
      return { label: m.label, count: c.count, color: m.color };
    })
    .sort((x, y) => y.count - x.count);

  return (
    <PageContainer>
      <PageHeader icon={"📈"} title="Analytics" subtitle="Trends, velocity and team performance" />

      {/* headline metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total issues" value={a.total} icon={<Layers size={18} />} accent="#5b5bd6" sub="all types" />
        <StatTile
          label="Open"
          value={a.open}
          icon={<CircleDot size={18} />}
          accent="#d97706"
          sub={`${resolvedRate}% resolved`}
        />
        <StatTile
          label="Avg resolution"
          value={avgResolution}
          icon={<Timer size={18} />}
          accent="#0891b2"
          sub="mean time to resolve"
        />
        <StatTile
          label="Critical open"
          value={a.critical}
          icon={<Flame size={18} />}
          accent="#dc2626"
          sub="needs attention"
        />
      </div>

      {/* trend + category donut */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-[13.5px] font-semibold">Created vs Resolved · 30 days</h2>
          <TrendChart created={a.created30} resolved={a.resolved30} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">By category</h2>
          <Donut items={byCategory} />
        </Card>
      </div>

      {/* breakdowns */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">By type</h2>
          <BarList items={byType} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">By priority</h2>
          <BarList items={byPriority} />
        </Card>
        <Card className="p-4 md:col-span-2">
          <h2 className="mb-3 text-[13.5px] font-semibold">Bugs by component</h2>
          <BarList items={byComponent} />
        </Card>
      </div>

      {/* tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* issues by project */}
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">Issues by project</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wider text-faint">
                  <th className="py-2 pr-3 font-medium">Project</th>
                  <th className="py-2 px-3 text-right font-medium">Total</th>
                  <th className="py-2 px-3 text-right font-medium">Open</th>
                  <th className="py-2 px-3 text-right font-medium">Done</th>
                  <th className="py-2 pl-3 text-right font-medium">Resolved %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.byProject.map((p) => {
                  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                  return (
                    <tr key={p.name} className="hover:bg-surface-2">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: colorFromString(p.name) }}
                          />
                          <span className="truncate">{p.name}</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{p.total}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-warning">{p.open}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-success">{p.done}</td>
                      <td className="py-2 pl-3">
                        <span className="flex items-center justify-end gap-2">
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 sm:block">
                            <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-9 text-right tabular-nums text-muted">{pct}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* team performance */}
        <Card className="p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold">Team performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wider text-faint">
                  <th className="py-2 pr-3 font-medium">Member</th>
                  <th className="py-2 px-3 text-right font-medium">Assigned</th>
                  <th className="py-2 px-3 text-right font-medium">Resolved</th>
                  <th className="py-2 pl-3 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.byAssignee.map((m) => {
                  const pct = m.assigned ? Math.round((m.resolved / m.assigned) * 100) : 0;
                  return (
                    <tr key={m.name} className="hover:bg-surface-2">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <Avatar user={{ name: m.name, color: m.color, avatarUrl: null }} size={24} />
                          <span className="truncate">{m.name}</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{m.assigned}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-success">{m.resolved}</td>
                      <td className="py-2 pl-3">
                        <span className="flex items-center gap-2">
                          <span className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: m.color }}
                            />
                          </span>
                          <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-muted">{pct}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
