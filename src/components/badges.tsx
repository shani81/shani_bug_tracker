import { Badge } from "@/components/ui/primitives";
import { typeMeta, priorityMeta, severityMeta } from "@/lib/constants";
import type { StatusDTO, LabelDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TypeBadge({ type, showLabel = true }: { type: string; showLabel?: boolean }) {
  const m = typeMeta(type);
  return (
    <Badge color={m.color}>
      <span aria-hidden>{m.icon}</span>
      {showLabel && m.label}
    </Badge>
  );
}

export function TypeIcon({ type }: { type: string }) {
  const m = typeMeta(type);
  return (
    <span title={m.label} aria-label={m.label}>
      {m.icon}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const m = priorityMeta(priority);
  return (
    <Badge color={m.color} dot>
      {m.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const m = severityMeta(severity);
  return <Badge color={m.color}>{m.label}</Badge>;
}

export function StatusPill({ status, className }: { status: StatusDTO; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium",
        className,
      )}
      style={{
        color: status.color,
        backgroundColor: `color-mix(in srgb, ${status.color} 14%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}

export function LabelChip({ label }: { label: LabelDTO }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        color: label.color,
        backgroundColor: `color-mix(in srgb, ${label.color} 13%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
    </span>
  );
}
