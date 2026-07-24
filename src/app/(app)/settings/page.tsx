import { getSettings } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { SettingsView } from "@/components/modules/settings-view";
import { getAuthContext, can } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/primitives";
import { Lock } from "lucide-react";

export default async function SettingsPage() {
  // This page exposes the member roster (names + emails + roles) and every
  // automation rule, so it needs its own gate — the (app) layout only proves
  // the caller is signed in, not that they may administer the workspace.
  const ctx = await getAuthContext();
  const allowed = ctx ? can(ctx.orgRole, "member:manage") : false;

  if (!allowed) {
    return (
      <PageContainer>
        <PageHeader icon={"⚙️"} title="Settings" subtitle="Workspace administration" />
        <EmptyState
          icon={<Lock size={22} />}
          title="You don't have access to settings"
          description="Workspace settings are available to admins and owners. Ask an admin if you need a change made."
        />
      </PageContainer>
    );
  }

  const data = await getSettings();

  return (
    <PageContainer>
      <PageHeader icon={"⚙️"} title="Settings" subtitle="Projects, team, workflows and automation" />
      <SettingsView data={data} />
    </PageContainer>
  );
}
