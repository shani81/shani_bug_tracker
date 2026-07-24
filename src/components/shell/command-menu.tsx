"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Plus } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import { NavIcon } from "@/components/icon";
import { typeMeta } from "@/lib/constants";
import { useQuickAdd } from "@/components/quick-add";

type Result = { id: string; key: string; title: string; type: string; priority: string; projectKey: string };

export function CommandMenu() {
  const router = useRouter();
  const quickAdd = useQuickAdd();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else {
      setQ("");
      setResults([]);
      setActive(0);
    }
  }, [open]);

  React.useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setActive(0);
      } catch {
        /* ignore */
      }
    }, 140);
    return () => clearTimeout(t);
  }, [q]);

  const navMatches = q
    ? NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()))
    : NAV_ITEMS;

  type Row = { kind: "nav"; href: string; label: string; icon: string } | { kind: "issue"; r: Result };
  const rows: Row[] = [
    ...navMatches.map((n) => ({ kind: "nav" as const, href: n.href, label: n.label, icon: n.icon })),
    ...results.map((r) => ({ kind: "issue" as const, r })),
  ];

  function go(row: Row) {
    setOpen(false);
    if (row.kind === "nav") router.push(row.href);
    else router.push(`/issue/${row.r.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && rows[active]) {
      e.preventDefault();
      go(rows[active]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />
      <div className="card animate-in relative z-10 w-full max-w-xl overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search issues or jump to…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          <button
            onClick={() => {
              setOpen(false);
              quickAdd.open("bug");
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] hover:bg-surface-2"
          >
            <Plus size={16} className="text-primary" />
            <span className="font-medium">Report a new bug…</span>
          </button>

          {rows.length === 0 && q && (
            <p className="px-3 py-6 text-center text-[13px] text-muted">No results for “{q}”.</p>
          )}

          {rows.map((row, i) => (
            <button
              key={row.kind === "nav" ? row.href : row.r.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(row)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] ${
                active === i ? "bg-surface-2" : ""
              }`}
            >
              {row.kind === "nav" ? (
                <>
                  <NavIcon name={row.icon} size={16} className="text-muted" />
                  <span>{row.label}</span>
                  <span className="ml-auto text-[11px] text-faint">Go to</span>
                </>
              ) : (
                <>
                  <span>{typeMeta(row.r.type).icon}</span>
                  <span className="font-mono text-[11.5px] text-muted">{row.r.key}</span>
                  <span className="min-w-0 flex-1 truncate">{row.r.title}</span>
                  {active === i && <CornerDownLeft size={14} className="text-faint" />}
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
