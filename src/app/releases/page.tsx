import { Rocket, Timer, Ship } from "lucide-react";
import { getReleases, type ReleaseData } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { StatTile } from "@/components/dashboard/charts";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { RELEASE_STATUSES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

const STATUS_MAP = Object.fromEntries(RELEASE_STATUSES.map((s) => [s.value, s]));

// in_progress first, then planned, then released, then everything else (rolled_back).
const SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  planned: 1,
  released: 2,
  rolled_back: 3,
};

function statusMeta(value: string) {
  return STATUS_MAP[value] ?? { value, label: value, color: "#9095a6" };
}

export default async function ReleasesPage() {
  const releases = await getReleases();

  const total = releases.length;
  const inProgress = releases.filter((r) => r.status === "in_progress").length;
  const shipped = releases.filter((r) => r.status === "released").length;

  const sorted = [...releases].sort((a, b) => {
    const oa = SORT_ORDER[a.status] ?? 99;
    const ob = SORT_ORDER[b.status] ?? 99;
    if (oa !== ob) return oa - ob;
    // within a status group, newest release date first (nulls last).
    const ta = a.releaseDate ? Date.parse(a.releaseDate) : -Infinity;
    const tb = b.releaseDate ? Date.parse(b.releaseDate) : -Infinity;
    return tb - ta;
  });

  return (
    <PageContainer>
      <PageHeader
        icon={"🚀"}
        title="Releases"
        subtitle="Version management, release notes & deployment status"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Total releases"
          value={total}
          icon={<Rocket size={18} />}
          accent="#5b5bd6"
          sub="all versions"
        />
        <StatTile
          label="In progress"
          value={inProgress}
          icon={<Timer size={18} />}
          accent="#d97706"
          sub="actively shipping"
        />
        <StatTile
          label="Shipped"
          value={shipped}
          icon={<Ship size={18} />}
          accent="#16a34a"
          sub="released to production"
        />
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Rocket size={40} />}
          title="No releases yet"
          description="Releases you plan and ship will appear here with their fix progress and deployment status."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map((r) => (
            <ReleaseCard key={r.id} release={r} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function ReleaseCard({ release: r }: { release: ReleaseData }) {
  const meta = statusMeta(r.status);
  const pct = r.total > 0 ? Math.round((r.fixed / r.total) * 100) : 0;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[18px] font-semibold tracking-tight">{r.version}</span>
          <Badge>{r.projectKey}</Badge>
          <Badge color={meta.color} dot>
            {meta.label}
          </Badge>
        </div>
        {r.releaseDate && (
          <span className="shrink-0 whitespace-nowrap pt-1 text-[12px] text-faint">
            {formatDate(r.releaseDate)}
          </span>
        )}
      </div>

      <div className="min-w-0">
        {r.name && <p className="truncate text-[13.5px] font-medium text-muted">{r.name}</p>}
        {r.description && (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{r.description}</p>
        )}
      </div>

      <div className="mt-auto space-y-2">
        <div className="flex items-center justify-between text-[11.5px] text-faint">
          <span>Fix progress</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[12px] text-muted">
          <span className="font-medium text-text">{r.fixed}</span> fixed ·{" "}
          <span className="font-medium text-text">{r.open}</span> open ·{" "}
          <span className="font-medium text-text">{r.total}</span> total
        </p>
      </div>
    </Card>
  );
}
