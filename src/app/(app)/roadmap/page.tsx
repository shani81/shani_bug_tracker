import { CalendarDays, CircleCheck, Milestone, Rocket, Timer } from "lucide-react";
import { getReleases, type ReleaseData } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { StatTile } from "@/components/dashboard/charts";
import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui/primitives";
import { RELEASE_STATUSES } from "@/lib/constants";
import { formatDate, relativeTime, withAlpha } from "@/lib/utils";

const STATUS_MAP = Object.fromEntries(RELEASE_STATUSES.map((s) => [s.value, s]));

function statusMeta(value: string) {
  return STATUS_MAP[value] ?? { value, label: value, color: "#9095a6" };
}

/** A milestone is "done" once it has shipped (or was rolled back). */
function isSettled(status: string) {
  return status === "released" || status === "rolled_back";
}

/** "Q3 2026" — the timeline group a milestone falls into. */
function quarterOf(iso: string) {
  const d = new Date(iso);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { key: `${d.getFullYear()}-Q${q}`, label: `Q${q} ${d.getFullYear()}` };
}

type TimelineGroup = { key: string; label: string; items: ReleaseData[] };

/** Chronological groups, earliest first, undated milestones last. */
function buildGroups(releases: ReleaseData[]): TimelineGroup[] {
  const sorted = [...releases].sort((a, b) => {
    const ta = a.releaseDate ? Date.parse(a.releaseDate) : Infinity;
    const tb = b.releaseDate ? Date.parse(b.releaseDate) : Infinity;
    if (ta !== tb) return ta - tb;
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });

  const groups: TimelineGroup[] = [];
  for (const r of sorted) {
    const { key, label } = r.releaseDate
      ? quarterOf(r.releaseDate)
      : { key: "unscheduled", label: "Unscheduled" };
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(r);
  }
  return groups;
}

export default async function RoadmapPage() {
  const releases = await getReleases();
  const now = Date.now();

  const groups = buildGroups(releases);

  const scheduled = releases.filter((r) => r.releaseDate).length;
  const inProgress = releases.filter((r) => r.status === "in_progress").length;
  const shipped = releases.filter((r) => r.status === "released").length;
  const totalIssues = releases.reduce((a, r) => a + r.total, 0);
  const fixedIssues = releases.reduce((a, r) => a + r.fixed, 0);
  const overallPct = totalIssues > 0 ? Math.round((fixedIssues / totalIssues) * 100) : 0;

  // The earliest milestone that hasn't shipped yet — what the team is heading to next.
  const upNextId =
    [...releases]
      .filter((r) => !isSettled(r.status) && r.releaseDate)
      .sort((a, b) => Date.parse(a.releaseDate!) - Date.parse(b.releaseDate!))[0]?.id ?? null;

  return (
    <PageContainer>
      <PageHeader
        icon={"🗺️"}
        title="Roadmap"
        subtitle="Milestones, releases and what's shipping next"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Milestones"
          value={releases.length}
          icon={<Milestone size={18} />}
          accent="#5b5bd6"
          sub={`${scheduled} scheduled`}
        />
        <StatTile
          label="In flight"
          value={inProgress}
          icon={<Timer size={18} />}
          accent="#d97706"
          sub="actively shipping"
        />
        <StatTile
          label="Shipped"
          value={shipped}
          icon={<Rocket size={18} />}
          accent="#16a34a"
          sub="delivered to production"
        />
        <StatTile
          label="Issues done"
          value={`${fixedIssues}/${totalIssues}`}
          icon={<CircleCheck size={18} />}
          accent="#8b5cf6"
          sub={`${overallPct}% across all milestones`}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Milestone size={40} />}
          title="Nothing on the roadmap yet"
          description="Milestones appear here as soon as releases are planned, laid out on a timeline with their fix progress."
        />
      ) : (
        <div className="min-w-0">
          {groups.map((group) => (
            <GroupSection key={group.key} group={group} now={now} upNextId={upNextId} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function GroupSection({
  group,
  now,
  upNextId,
}: {
  group: TimelineGroup;
  now: number;
  upNextId: string | null;
}) {
  const total = group.items.reduce((a, r) => a + r.total, 0);
  const fixed = group.items.reduce((a, r) => a + r.fixed, 0);

  return (
    <section className="mt-7 first:mt-0">
      {/* group header, aligned to the timeline rail */}
      <div className="mb-3 flex items-center gap-3 md:gap-4">
        <span aria-hidden className="flex w-3 shrink-0 justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <SectionTitle>{group.label}</SectionTitle>
          <span className="text-[11px] text-faint">
            {group.items.length} milestone{group.items.length === 1 ? "" : "s"}
            {total > 0 && (
              <>
                {" · "}
                <span className="tabular-nums">
                  {fixed}/{total}
                </span>{" "}
                issues done
              </>
            )}
          </span>
          <span aria-hidden className="hidden h-px min-w-8 flex-1 bg-border sm:block" />
        </div>
      </div>

      {group.items.map((r) => (
        <MilestoneRow key={r.id} release={r} now={now} isUpNext={r.id === upNextId} />
      ))}
    </section>
  );
}

function MilestoneRow({
  release: r,
  now,
  isUpNext,
}: {
  release: ReleaseData;
  now: number;
  isUpNext: boolean;
}) {
  const meta = statusMeta(r.status);
  const pct = r.total > 0 ? Math.round((r.fixed / r.total) * 100) : 0;
  const isOverdue = !!r.releaseDate && Date.parse(r.releaseDate) < now && !isSettled(r.status);

  return (
    <div className="relative flex gap-3 pb-3 last:pb-0 md:gap-4">
      {/* vertical rail — spans the row incl. its bottom padding so it reads as one line */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-[6px] w-0 -translate-x-1/2 border-l border-border"
      />

      {/* milestone dot sitting on the rail */}
      <span
        aria-hidden
        className="relative z-10 mt-[21px] h-3 w-3 shrink-0 self-start rounded-full"
        style={{
          backgroundColor: meta.color,
          boxShadow: `0 0 0 3px var(--bg), 0 0 0 5px ${withAlpha(meta.color, 0.22)}`,
        }}
      />

      <Card className="min-w-0 flex-1 p-4 transition-colors hover:bg-surface-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[15px] font-semibold tracking-tight">{r.version}</h3>
              <Badge>{r.projectKey}</Badge>
              {isUpNext && <Badge className="bg-primary-soft text-primary">Up next</Badge>}
            </div>
            {r.name && <p className="mt-1 truncate text-[13px] font-medium">{r.name}</p>}
          </div>
          <Badge color={meta.color} dot className="shrink-0">
            {meta.label}
          </Badge>
        </div>

        {r.description && (
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
            {r.description}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} className="text-faint" />
            {r.releaseDate ? formatDate(r.releaseDate) : "No target date"}
          </span>
          {r.releaseDate && <span className="text-faint">{relativeTime(r.releaseDate)}</span>}
          {isOverdue && <span className="font-medium text-warning">Overdue</span>}
        </div>

        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: meta.color }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px]">
            <span className="text-muted">
              {r.total > 0 ? (
                <>
                  <span className="font-medium tabular-nums text-text">
                    {r.fixed}/{r.total}
                  </span>{" "}
                  issues done
                </>
              ) : (
                "No issues linked yet"
              )}
            </span>
            {r.total > 0 && (
              <span className="shrink-0 tabular-nums text-faint">
                {r.open} open · {pct}%
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
