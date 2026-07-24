"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Paperclip, Trash2, Check } from "lucide-react";
import { AvatarStack } from "@/components/ui/primitives";
import { TypeIcon, PriorityBadge, StatusPill, LabelChip } from "@/components/badges";
import { PRIORITIES, STATUS_CATEGORIES } from "@/lib/constants";
import { useWorkspace } from "@/components/workspace";
import { updateIssue, changeStatus, softDeleteIssue } from "@/lib/actions";
import { relativeTime, cn } from "@/lib/utils";
import type { IssueDTO } from "@/lib/types";

export function IssueList({ issues }: { issues: IssueDTO[] }) {
  const router = useRouter();
  const ws = useWorkspace();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setSelected(new Set()), [issues]);

  const allSelected = issues.length > 0 && selected.size === issues.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(issues.map((i) => i.id)));
  }

  async function bulkPriority(priority: string) {
    setBusy(true);
    await Promise.all([...selected].map((id) => updateIssue(id, { priority })));
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }
  async function bulkMove(category: string) {
    setBusy(true);
    await Promise.all(
      [...selected].map((id) => {
        const issue = issues.find((i) => i.id === id);
        const project = ws.projects.find((p) => p.id === issue?.projectId);
        const target = project?.statuses.filter((s) => s.category === category).sort((a, b) => a.order - b.order)[0];
        return target ? changeStatus(id, target.id) : Promise.resolve();
      }),
    );
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }
  async function bulkDelete() {
    setBusy(true);
    await Promise.all([...selected].map((id) => softDeleteIssue(id)));
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="card overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface-2/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
        <button
          onClick={toggleAll}
          className={cn(
            "grid h-4 w-4 place-items-center rounded border",
            allSelected ? "border-primary bg-primary text-primary-fg" : "border-border-strong",
          )}
          aria-label="Select all"
        >
          {allSelected && <Check size={12} />}
        </button>
        <span className="w-20">Key</span>
        <span className="flex-1">Title</span>
        <span className="hidden w-24 sm:block">Priority</span>
        <span className="hidden w-28 md:block">Status</span>
        <span className="hidden w-16 lg:block">People</span>
        <span className="hidden w-20 text-right lg:block">Updated</span>
      </div>

      {/* rows */}
      <div className="divide-y divide-border">
        {issues.map((issue) => {
          const isSel = selected.has(issue.id);
          return (
            <div
              key={issue.id}
              onClick={() => router.push(`/issue/${issue.id}`)}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-surface-2/60",
                isSel && "bg-primary-soft/40",
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(issue.id);
                }}
                className={cn(
                  "grid h-4 w-4 shrink-0 place-items-center rounded border",
                  isSel ? "border-primary bg-primary text-primary-fg" : "border-border-strong",
                )}
                aria-label="Select"
              >
                {isSel && <Check size={12} />}
              </button>
              <span className="flex w-20 shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-muted">
                <TypeIcon type={issue.type} />
                {issue.key}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{issue.title}</span>
                {issue.labels.slice(0, 2).map((l) => (
                  <span key={l.id} className="hidden xl:inline">
                    <LabelChip label={l} />
                  </span>
                ))}
                {(issue.commentCount > 0 || issue.attachmentCount > 0) && (
                  <span className="ml-1 hidden items-center gap-2 text-[11px] text-faint sm:flex">
                    {issue.commentCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare size={11} />
                        {issue.commentCount}
                      </span>
                    )}
                    {issue.attachmentCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Paperclip size={11} />
                        {issue.attachmentCount}
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="hidden w-24 shrink-0 sm:block">
                <PriorityBadge priority={issue.priority} />
              </span>
              <span className="hidden w-28 shrink-0 md:block">
                <StatusPill status={issue.status} />
              </span>
              <span className="hidden w-16 shrink-0 lg:block">
                <AvatarStack users={issue.assignees} size={22} max={2} />
              </span>
              <span className="hidden w-20 shrink-0 text-right text-[11.5px] text-faint lg:block">
                {relativeTime(issue.updatedAt)}
              </span>
            </div>
          );
        })}
        {issues.length === 0 && (
          <div className="px-3 py-16 text-center text-[13px] text-muted">No issues match your filters.</div>
        )}
      </div>

      {/* bulk action bar */}
      {selected.size > 0 && (
        <div className="animate-in fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-lg">
          <span className="text-[12.5px] font-medium">{selected.size} selected</span>
          <span className="mx-1 h-4 w-px bg-border" />
          <select
            className="input h-8 w-auto py-1 text-[12px]"
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value && bulkPriority(e.target.value)}
          >
            <option value="">Priority…</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="input h-8 w-auto py-1 text-[12px]"
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value && bulkMove(e.target.value)}
          >
            <option value="">Move to…</option>
            {STATUS_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={bulkDelete}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[12px] text-muted hover:text-text">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
