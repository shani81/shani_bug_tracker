import { Gauge } from "lucide-react";
import { getSprints, type SprintData } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { CreateBar } from "@/components/modules/create-bar";
import { getWorkspace } from "@/lib/queries";
import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui/primitives";
import { SPRINT_STATUSES } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";

function sprintMeta(value: string) {
  return SPRINT_STATUSES.find((s) => s.value === value) ?? { value, label: value, color: "#9095a6" };
}

function ProgressBar({
  label,
  done,
  total,
  fillClass,
}: {
  label: string;
  done: number;
  total: number;
  fillClass: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-medium text-muted">{label}</span>
        <span className="text-[11.5px] tabular-nums text-faint">
          <span className="font-semibold text-text">{done}</span>/{total}
          <span className="ml-1.5">{pct}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", fillClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SprintCard({ sprint }: { sprint: SprintData }) {
  const meta = sprintMeta(sprint.status);
  return (
    <Card className="relative flex flex-col gap-3 overflow-hidden p-4 transition-colors hover:bg-surface-2">
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: meta.color }} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-[14px] font-semibold leading-tight">{sprint.name}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge>{sprint.projectKey}</Badge>
          <Badge color={meta.color} dot>
            {meta.label}
          </Badge>
        </div>
      </div>

      {sprint.goal && <p className="text-[12.5px] leading-relaxed text-muted">{sprint.goal}</p>}

      <p className="text-[12px] text-faint">
        {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
      </p>

      <div className="mt-auto flex flex-col gap-2.5 pt-1">
        <ProgressBar label="Issues" done={sprint.done} total={sprint.total} fillClass="bg-primary" />
        <ProgressBar label="Story points" done={sprint.donePoints} total={sprint.points} fillClass="bg-success" />
      </div>
    </Card>
  );
}

function SprintSection({ title, sprints }: { title: string; sprints: SprintData[] }) {
  if (sprints.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SectionTitle>{title}</SectionTitle>
        <span className="text-[11px] font-medium tabular-nums text-faint">{sprints.length}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sprints.map((s) => (
          <SprintCard key={s.id} sprint={s} />
        ))}
      </div>
    </section>
  );
}

export default async function SprintsPage() {
  const [sprints, workspace] = await Promise.all([getSprints(), getWorkspace()]);
  const projectOptions = (workspace?.projects ?? []).map((p) => ({ id: p.id, name: p.name }));

  const active = sprints.filter((s) => s.status === "active");
  const planned = sprints.filter((s) => s.status === "planned");
  const completed = sprints.filter((s) => s.status === "completed");
  const other = sprints.filter((s) => !["active", "planned", "completed"].includes(s.status));

  return (
    <PageContainer>
      <PageHeader
        icon={"📊"}
        title="Sprint Planning"
        subtitle="Plan, track and burn down your sprints"
        actions={<CreateBar kind="sprint" projects={projectOptions} />}
      />

      {sprints.length === 0 ? (
        <EmptyState
          icon={<Gauge size={28} />}
          title="No sprints yet"
          description="Sprints group issues into a fixed time box so you can track scope, velocity and burndown."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <SprintSection title="Active" sprints={active} />
          <SprintSection title="Planned" sprints={planned} />
          <SprintSection title="Completed" sprints={completed} />
          <SprintSection title="Other" sprints={other} />
        </div>
      )}
    </PageContainer>
  );
}
