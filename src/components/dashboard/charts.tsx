import { withAlpha } from "@/lib/utils";

// ── Two-series 30-day trend (created vs resolved) ────────────────────────────

export function TrendChart({
  created,
  resolved,
  height = 160,
}: {
  created: { date: string; count: number }[];
  resolved: { date: string; count: number }[];
  height?: number;
}) {
  const w = 640;
  const h = height;
  const pad = 8;
  const n = Math.max(created.length, 1);
  const max = Math.max(1, ...created.map((d) => d.count), ...resolved.map((d) => d.count));
  const x = (i: number) => pad + (i * (w - pad * 2)) / (n - 1 || 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = (arr: { count: number }[]) => arr.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.count)}`).join(" ");
  const area = (arr: { count: number }[]) =>
    `${line(arr)} L${x(n - 1)},${h - pad} L${x(0)},${h - pad} Z`;

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <path d={area(created)} fill={withAlpha("#5b5bd6", 0.12)} />
        <path d={line(created)} fill="none" stroke="#5b5bd6" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={line(resolved)} fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="1 0" />
      </svg>
      <div className="mt-2 flex items-center gap-4 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "#5b5bd6" }} /> Created
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "#16a34a" }} /> Resolved
        </span>
      </div>
    </div>
  );
}

// ── Horizontal bar list ──────────────────────────────────────────────────────

export function BarList({ items }: { items: { label: string; count: number; color: string; icon?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) return <p className="py-6 text-center text-[13px] text-muted">No data</p>;
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 text-[12.5px]">
          <span className="flex w-28 shrink-0 items-center gap-1.5 truncate">
            {it.icon && <span>{it.icon}</span>}
            <span className="truncate">{it.label}</span>
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${(it.count / max) * 100}%`, backgroundColor: it.color }}
            />
          </div>
          <span className="w-8 shrink-0 text-right tabular-nums text-muted">{it.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────

export function Donut({
  items,
  size = 148,
}: {
  items: { label: string; count: number; color: string }[];
  size?: number;
}) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        {items.map((it) => {
          const frac = it.count / total;
          const dash = frac * c;
          const seg = (
            <circle
              key={it.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={it.color}
              strokeWidth={14}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return seg;
        })}
        <circle cx={size / 2} cy={size / 2} r={r - 12} fill="var(--surface)" />
      </svg>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color }} />
            <span className="flex-1">{it.label}</span>
            <span className="tabular-nums text-muted">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {icon && <span style={{ color: accent }}>{icon}</span>}
      </div>
      <p className="mt-1.5 text-[26px] font-semibold tracking-tight" style={{ color: accent }}>
        {value}
      </p>
      {sub && <p className="text-[11.5px] text-faint">{sub}</p>}
    </div>
  );
}
