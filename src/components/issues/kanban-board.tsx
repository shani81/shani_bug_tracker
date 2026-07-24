"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { STATUS_CATEGORIES } from "@/lib/constants";
import { useWorkspace } from "@/components/workspace";
import { changeStatus } from "@/lib/actions";
import { IssueCard } from "@/components/issues/issue-card";
import type { IssueDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

export function KanbanBoard({ issues }: { issues: IssueDTO[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [items, setItems] = React.useState(issues);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCat, setOverCat] = React.useState<string | null>(null);

  React.useEffect(() => setItems(issues), [issues]);

  const columns = STATUS_CATEGORIES.map((c) => ({
    ...c,
    issues: items
      .filter((i) => i.status.category === c.value)
      .sort((a, b) => a.boardOrder - b.boardOrder),
  }));

  function onDrop(category: string) {
    setOverCat(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const issue = items.find((i) => i.id === id);
    if (!issue || issue.status.category === category) return;

    // find a target status in the issue's project matching the dropped category
    const project = ws.projects.find((p) => p.id === issue.projectId);
    const target = project?.statuses
      .filter((s) => s.category === category)
      .sort((a, b) => a.order - b.order)[0];
    if (!target) return;

    // optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: target } : i)),
    );
    changeStatus(id, target.id)
      .then(() => router.refresh())
      .catch(() => setItems(issues)); // revert on failure
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col.value}
          onDragOver={(e) => {
            e.preventDefault();
            setOverCat(col.value);
          }}
          onDragLeave={() => setOverCat((c) => (c === col.value ? null : c))}
          onDrop={() => onDrop(col.value)}
          className={cn(
            "flex w-72 shrink-0 flex-col rounded-xl border transition-colors",
            overCat === col.value ? "border-primary bg-primary-soft/40" : "border-border bg-surface-2/40",
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
            <span className="text-[12.5px] font-semibold">{col.label}</span>
            <span className="ml-auto rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-muted">
              {col.issues.length}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {col.issues.map((issue) => (
              <div
                key={issue.id}
                onDragEnd={() => {
                  setDragId(null);
                  setOverCat(null);
                }}
              >
                <IssueCard
                  issue={issue}
                  draggable
                  onDragStart={() => setDragId(issue.id)}
                />
              </div>
            ))}
            {col.issues.length === 0 && (
              <div className="rounded-lg border border-dashed border-border py-8 text-center text-[11.5px] text-faint">
                Drop here
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
