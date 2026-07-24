"use client";

import * as React from "react";
import { ThemeProvider } from "@/components/theme";
import { RealtimeProvider } from "@/components/realtime";
import { WorkspaceProvider } from "@/components/workspace";
import { QuickAddProvider } from "@/components/quick-add";
import type { WorkspaceData } from "@/lib/types";

/** Available everywhere, including unauthenticated pages. */
export function RootProviders({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

/** Only mounted inside the authenticated app shell. */
export function AppProviders({ workspace, children }: { workspace: WorkspaceData; children: React.ReactNode }) {
  return (
    <WorkspaceProvider value={workspace}>
      <RealtimeProvider>
        <QuickAddProvider>{children}</QuickAddProvider>
      </RealtimeProvider>
    </WorkspaceProvider>
  );
}
