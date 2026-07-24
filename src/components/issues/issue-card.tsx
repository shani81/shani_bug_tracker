"use client";

import Link from "next/link";
import { MessageSquare, Paperclip, Eye } from "lucide-react";
import { typeMeta, priorityMeta } from "@/lib/constants";
import { AvatarStack } from "@/components/ui/primitives";
import { LabelChip } from "@/components/badges";
import type { IssueDTO } from "@/lib/types";

// Compact card used on the kanban board.
export function IssueCard({
  issue,
  draggable,
  onDragStart,
}: {
  issue: IssueDTO;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const t = typeMeta(issue.type);
  const p = priorityMeta(issue.priority);
  return (
    <Link
      href={`/issue/${issue.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      className="card block cursor-pointer select-none p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span title={t.label}>{t.icon}</span>
        <span className="font-mono">{issue.key}</span>
        <span
          className="ml-auto h-2 w-2 rounded-full"
          style={{ backgroundColor: p.color }}
          title={`Priority: ${p.label}`}
        />
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug">{issue.title}</p>
      {issue.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-faint">
        {issue.commentCount > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquare size={12} /> {issue.commentCount}
          </span>
        )}
        {issue.attachmentCount > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={12} /> {issue.attachmentCount}
          </span>
        )}
        {issue.watcherCount > 0 && (
          <span className="flex items-center gap-1">
            <Eye size={12} /> {issue.watcherCount}
          </span>
        )}
        <span className="ml-auto">
          <AvatarStack users={issue.assignees} size={20} max={3} />
        </span>
      </div>
    </Link>
  );
}
