import { ModulePage } from "@/components/issues/module-page";

export default function ImprovementsPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string; view?: string }>;
}) {
  return <ModulePage group="improvement" searchParams={searchParams} />;
}
