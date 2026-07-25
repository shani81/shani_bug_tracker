"use client";

import * as React from "react";
import { List, Kanban, Search, X } from "lucide-react";
import { IssueList } from "@/components/issues/issue-list";
import { KanbanBoard } from "@/components/issues/kanban-board";
import { useWorkspace } from "@/components/workspace";
import { SavedViews } from "@/components/issues/saved-views";
import type { SavedViewDTO } from "@/lib/queries";
import { PRIORITIES, STATUS_CATEGORIES, type IssueGroup } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { IssueDTO } from "@/lib/types";

type View = "list" | "board";

export function IssueWorkspace({
  issues,
  group,
  initialProjectId,
  initialView = "list",
  savedViews = [],
}: {
  issues: IssueDTO[];
  group: IssueGroup;
  initialProjectId?: string;
  initialView?: View;
  savedViews?: SavedViewDTO[];
}) {
  const ws = useWorkspace();
  const [view, setView] = React.useState<View>(initialView);
  const [q, setQ] = React.useState("");
  const [projectId, setProjectId] = React.useState(initialProjectId ?? "");
  const [category, setCategory] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);

  // The current filter, in the shape a saved view stores.
  const currentFilter = React.useMemo(
    () => ({
      ...(projectId ? { projectId } : {}),
      ...(category ? { statusId: category } : {}),
      ...(priority ? { priority } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(q.trim() ? { search: q.trim() } : {}),
      view,
    }),
    [projectId, category, priority, assigneeId, q, view],
  );

  /** Apply a saved view, or reset everything when passed null. */
  const applyView = React.useCallback((v: SavedViewDTO | null) => {
    setActiveViewId(v?.id ?? null);
    const f = v?.filter ?? {};
    setProjectId(f.projectId ?? "");
    setCategory(f.statusId ?? "");
    setPriority(f.priority ?? "");
    setAssigneeId(f.assigneeId ?? "");
    setQ(f.search ?? "");
    if (f.view === "board" || f.view === "list") setView(f.view);
  }, []);

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return issues.filter((i) => {
      if (projectId && i.projectId !== projectId) return false;
      if (category && i.status.category !== category) return false;
      if (priority && i.priority !== priority) return false;
      if (assigneeId && !i.assignees.some((a) => a.id === assigneeId)) return false;
      if (term && !(`${i.key} ${i.title}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [issues, q, projectId, category, priority, assigneeId]);

  const hasFilters = q || projectId || category || priority || assigneeId;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SavedViews
        views={savedViews}
        group={group}
        currentFilter={currentFilter}
        activeViewId={activeViewId}
        onApply={applyView}
      />

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1 sm:max-w-56">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveViewId(null); }}
            placeholder="Filter…"
            className="input h-8 py-1 pl-8 text-[12.5px]"
          />
        </div>

        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setActiveViewId(null); }} className="input h-8 w-auto py-1 text-[12.5px]">
          <option value="">All projects</option>
          {ws.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select value={category} onChange={(e) => { setCategory(e.target.value); setActiveViewId(null); }} className="input h-8 w-auto py-1 text-[12.5px]">
          <option value="">Any status</option>
          {STATUS_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select value={priority} onChange={(e) => { setPriority(e.target.value); setActiveViewId(null); }} className="input h-8 w-auto py-1 text-[12.5px]">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <select value={assigneeId} onChange={(e) => { setAssigneeId(e.target.value); setActiveViewId(null); }} className="input hidden h-8 w-auto py-1 text-[12.5px] sm:block">
          <option value="">Anyone</option>
          {ws.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => {
              setQ("");
              setProjectId("");
              setCategory("");
              setPriority("");
              setAssigneeId("");
            }}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
          >
            <X size={13} /> Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            onClick={() => setView("list")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px]",
              view === "list" ? "bg-surface-2 text-text" : "text-muted hover:text-text",
            )}
          >
            <List size={14} /> List
          </button>
          <button
            onClick={() => setView("board")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px]",
              view === "board" ? "bg-surface-2 text-text" : "text-muted hover:text-text",
            )}
          >
            <Kanban size={14} /> Board
          </button>
        </div>
      </div>

      <p className="text-[12px] text-faint">
        {filtered.length} {filtered.length === 1 ? "issue" : "issues"}
        {hasFilters ? " (filtered)" : ""}
      </p>

      {/* content */}
      {view === "list" ? (
        <IssueList issues={filtered} />
      ) : (
        <div className="min-h-0 flex-1">
          <KanbanBoard issues={filtered} />
        </div>
      )}
    </div>
  );
}
