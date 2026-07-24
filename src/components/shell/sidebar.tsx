"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/constants";
import { NavIcon } from "@/components/icon";
import { useWorkspace } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const ws = useWorkspace();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* org header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-bold text-white"
          style={{ backgroundColor: ws.orgColor }}
        >
          {ws.orgName[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-tight">{ws.orgName}</p>
          <p className="truncate text-[11px] text-faint">Bug Tracker</p>
        </div>
        {onNavigate && (
          <button onClick={onNavigate} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 lg:hidden">
            <X size={18} />
          </button>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-1.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const count = item.badgeKey ? ws.counts[item.badgeKey] : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                active ? "bg-primary-soft text-text" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <NavIcon
                name={item.icon}
                size={18}
                className={active ? "text-primary" : "text-faint group-hover:text-muted"}
              />
              <span className="flex-1">{item.label}</span>
              {count ? (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
                    active ? "bg-primary text-primary-fg" : "bg-surface-3 text-muted",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* projects */}
      <div className="px-2.5 py-2">
        <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Projects</p>
        <div className="space-y-0.5">
          {ws.projects.map((p) => (
            <Link
              key={p.id}
              href={`/bugs?project=${p.id}`}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
            >
              <span className="text-[15px] leading-none">{p.icon}</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="font-mono text-[10.5px] text-faint">{p.key}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* current user */}
      {ws.currentUser && (
        <div className="flex items-center gap-2.5 border-t border-border px-4 py-3">
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: ws.currentUser.color }}
          >
            {ws.currentUser.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium leading-tight">{ws.currentUser.name}</p>
            <p className="truncate text-[11px] text-faint">{ws.currentUser.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}
