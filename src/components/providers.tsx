"use client";

import * as React from "react";
import { ThemeProvider } from "@/components/theme";
import { RealtimeProvider } from "@/components/realtime";
import { WorkspaceProvider } from "@/components/workspace";
import { QuickAddProvider } from "@/components/quick-add";
import type { WorkspaceData } from "@/lib/types";

export function Providers({ workspace, children }: { workspace: WorkspaceData; children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <WorkspaceProvider value={workspace}>
        <RealtimeProvider>
          <QuickAddProvider>{children}</QuickAddProvider>
        </RealtimeProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
