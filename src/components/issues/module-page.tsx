import { listIssues } from "@/lib/queries";
import { IssueWorkspace } from "@/components/issues/issue-workspace";
import { ReportButton } from "@/components/issues/report-button";
import { PageHeader, PageContainer } from "@/components/page-header";
import { GROUP_LABELS, type IssueGroup } from "@/lib/constants";

const META: Record<IssueGroup, { icon: string; title: string; subtitle: string }> = {
  bug: { icon: "🐞", title: "Bug Tracker", subtitle: "Track, triage and resolve bugs, errors and crashes." },
  feature: { icon: "✨", title: "Feature Requests", subtitle: "Collect and prioritize what to build next." },
  improvement: { icon: "📈", title: "Improvements", subtitle: "Enhancements, suggestions and polish." },
  task: { icon: "✅", title: "Tasks", subtitle: "Engineering tasks and documentation work." },
};

export async function ModulePage({
  group,
  searchParams,
}: {
  group: IssueGroup;
  searchParams?: Promise<{ project?: string; view?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const issues = await listIssues({ group });
  const meta = META[group];
  const open = issues.filter((i) => !["done", "canceled"].includes(i.status.category)).length;

  return (
    <PageContainer>
      <PageHeader
        icon={meta.icon}
        title={meta.title}
        subtitle={`${open} open · ${issues.length} total ${GROUP_LABELS[group].toLowerCase()}s`}
        actions={<ReportButton group={group} />}
      />
      <IssueWorkspace
        issues={issues}
        group={group}
        initialProjectId={sp.project}
        initialView={sp.view === "board" ? "board" : "list"}
      />
    </PageContainer>
  );
}
