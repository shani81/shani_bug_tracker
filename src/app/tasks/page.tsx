import { ModulePage } from "@/components/issues/module-page";

export default function TasksPage({ searchParams }: { searchParams?: Promise<{ project?: string; view?: string }> }) {
  return <ModulePage group="task" searchParams={searchParams} />;
}
