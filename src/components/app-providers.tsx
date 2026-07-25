"use client";

import * as React from "react";
import { RealtimeProvider } from "@/components/realtime";
import { WorkspaceProvider } from "@/components/workspace";
import { QuickAddProvider } from "@/components/quick-add";
import type { WorkspaceData } from "@/lib/types";

/**
 * Providers for the authenticated app only.
 *
 * Kept out of providers.tsx so the public login/invite pages don't pull this
 * module graph — QuickAddProvider reaches the issue form, which imports the
 * server actions, registering them as endpoints on unauthenticated routes.
 */
export function AppProviders({
  workspace,
  children,
}: {
  workspace: WorkspaceData;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider value={workspace}>
      <RealtimeProvider>
        <QuickAddProvider>{children}</QuickAddProvider>
      </RealtimeProvider>
    </WorkspaceProvider>
  );
}
