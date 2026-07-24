import { ModulePage } from "@/components/issues/module-page";

export default function FeaturesPage({ searchParams }: { searchParams?: Promise<{ project?: string; view?: string }> }) {
  return <ModulePage group="feature" searchParams={searchParams} />;
}
