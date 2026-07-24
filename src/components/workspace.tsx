"use client";

import * as React from "react";
import type { WorkspaceData } from "@/lib/types";

const Ctx = React.createContext<WorkspaceData | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceData {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
