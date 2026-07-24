"use client";

import * as React from "react";
import Link from "next/link";
import { PanelLeft, Search, Plus, Bell } from "lucide-react";
import { Button, Kbd } from "@/components/ui/primitives";
import { ThemeMenu } from "@/components/shell/theme-menu";
import { useWorkspace, useCan } from "@/components/workspace";
import { useQuickAdd } from "@/components/quick-add";
import { useRealtime } from "@/components/realtime";
import { cn } from "@/lib/utils";

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const ws = useWorkspace();
  const quickAdd = useQuickAdd();
  const { connected } = useRealtime();
  const canCreate = useCan("issue:create");

  function openCommand() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-md sm:px-4">
      <button
        onClick={onOpenSidebar}
        className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text lg:hidden"
        aria-label="Open menu"
      >
        <PanelLeft size={18} />
      </button>

      {/* search trigger */}
      <button
        onClick={openCommand}
        className="flex h-9 flex-1 items-center gap-2.5 rounded-lg border border-border bg-surface-2/60 px-3 text-[13px] text-faint hover:border-border-strong sm:max-w-md"
      >
        <Search size={15} />
        <span className="flex-1 text-left">Search issues…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex-1" />

      {/* realtime indicator */}
      <span
        className="hidden items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted sm:flex"
        title={connected ? "Live — real-time sync active" : "Reconnecting…"}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-warning")} />
        {connected ? "Live" : "…"}
      </span>

      <Link
        href="/notifications"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {ws.unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white">
            {ws.unread}
          </span>
        )}
      </Link>

      <ThemeMenu />

      {canCreate && (
        <Button variant="primary" size="sm" className="ml-1" onClick={() => quickAdd.open("bug")}>
          <Plus size={16} />
          <span className="hidden sm:inline">Report</span>
        </Button>
      )}
    </header>
  );
}
