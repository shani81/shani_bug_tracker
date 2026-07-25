"use client";

import * as React from "react";
import { ThemeProvider } from "@/components/theme";

/**
 * Providers available everywhere, including unauthenticated pages.
 * Deliberately minimal — see app-providers.tsx for the authenticated shell.
 */
export function RootProviders({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
