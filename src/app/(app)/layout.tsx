import { redirect } from "next/navigation";
import { AppProviders } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { getWorkspaceData } from "@/lib/workspace";
import { getAuthContext } from "@/lib/permissions";

// Auth gate for the whole application. Any route under (app) is unreachable
// without a valid session — this runs on the server before children render.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const workspace = await getWorkspaceData();
  if (!workspace) redirect("/login");

  return (
    <AppProviders workspace={workspace}>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
