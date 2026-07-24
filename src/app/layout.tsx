import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/components/theme";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { getWorkspaceData } from "@/lib/workspace";

const sans = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bug Tracker — Enterprise",
  description: "Fast, beautiful, real-time bug tracking, QA and release management.",
};

// Every screen reads live data from the database and updates over SSE, so
// nothing may be frozen into the build output. Set on the root layout, this
// applies to all nested route segments.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspaceData();

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        {workspace ? (
          <Providers workspace={workspace}>
            <AppShell>{children}</AppShell>
          </Providers>
        ) : (
          <div className="grid min-h-dvh place-items-center p-8 text-center">
            <div className="max-w-md">
              <h1 className="text-lg font-semibold">No workspace data yet</h1>
              <p className="mt-2 text-[13.5px] text-muted">
                The database looks empty. Run <code className="rounded bg-surface-2 px-1.5 py-0.5">npm run db:seed</code> to
                populate demo data, then refresh.
              </p>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
