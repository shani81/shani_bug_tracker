import { getSettings } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { SettingsView } from "@/components/modules/settings-view";

export default async function SettingsPage() {
  const data = await getSettings();

  return (
    <PageContainer>
      <PageHeader
        icon={"⚙️"}
        title="Settings"
        subtitle="Projects, team, workflows and automation"
      />
      <SettingsView data={data} />
    </PageContainer>
  );
}
