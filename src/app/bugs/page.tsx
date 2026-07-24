import { ModulePage } from "@/components/issues/module-page";

export default function BugsPage({ searchParams }: { searchParams?: Promise<{ project?: string; view?: string }> }) {
  return <ModulePage group="bug" searchParams={searchParams} />;
}
