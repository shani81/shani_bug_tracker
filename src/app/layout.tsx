import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/components/theme";
import { RootProviders } from "@/components/providers";
import { PwaProvider } from "@/components/pwa";

const sans = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bug Tracker — Enterprise",
  description: "Fast, beautiful, real-time bug tracking, QA and release management.",
  applicationName: "Bug Tracker",
  appleWebApp: { capable: true, title: "Bug Tracker", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// Colours the Android status bar to match the app, and keeps the layout clear
// of the display cutout on phones.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5b5bd6" },
    { media: "(prefers-color-scheme: dark)", color: "#14151d" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Every screen reads live, per-user data, so nothing may be frozen into the
// build output. Set on the root layout, this applies to all nested segments.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <RootProviders>{children}</RootProviders>
        <PwaProvider />
      </body>
    </html>
  );
}
