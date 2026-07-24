"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  Users,
  Zap,
  Palette,
  Workflow,
  Tag,
  Boxes,
  Sun,
  Moon,
  Rows3,
  Contrast,
  Sparkles,
  Activity,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Avatar, Badge, Card, EmptyState, SectionTitle, Spinner } from "@/components/ui/primitives";
import { StatTile } from "@/components/dashboard/charts";
import { toggleAutomation } from "@/lib/actions";
import { categoryMeta } from "@/lib/constants";
import { cn, colorFromString, withAlpha } from "@/lib/utils";
import type { SettingsData } from "@/lib/module-queries";

type Project = SettingsData["projects"][number];
type Member = SettingsData["members"][number];
type Automation = Project["automations"][number];

type Tab = "projects" | "team" | "automation" | "appearance";

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "projects", label: "Projects", icon: FolderKanban },
  { value: "team", label: "Team", icon: Users },
  { value: "automation", label: "Automation", icon: Zap },
  { value: "appearance", label: "Appearance", icon: Palette },
];

// Org-level membership roles: owner | admin | member | guest.
const ROLE_COLORS: Record<string, string> = {
  owner: "#5b5bd6",
  admin: "#d97706",
  member: "#0891b2",
  guest: "#64748b",
};
const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2, guest: 3 };

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? colorFromString(role);
}
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function SettingsView({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("projects");
  const [pending, startTransition] = React.useTransition();
  // Optimistic overrides so a switch flips instantly, before the refresh lands.
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});

  const automationCount = data.projects.reduce((sum, p) => sum + p.automations.length, 0);

  const counts: Record<Tab, number | undefined> = {
    projects: data.projects.length,
    team: data.members.length,
    automation: automationCount,
    appearance: undefined,
  };

  const isEnabled = React.useCallback(
    (a: Automation) => overrides[a.id] ?? a.isEnabled,
    [overrides],
  );

  function onToggle(a: Automation) {
    const next = !isEnabled(a);
    setOverrides((o) => ({ ...o, [a.id]: next }));
    startTransition(async () => {
      const res = await toggleAutomation(a.id);
      if (!res.ok) setOverrides((o) => ({ ...o, [a.id]: !next }));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      {/* tab nav — horizontal strip on mobile, vertical rail on desktop */}
      <nav
        aria-label="Settings sections"
        className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1.5 md:w-56 md:flex-col md:overflow-visible"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.value;
          const count = counts[t.value];
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors md:w-full",
                active ? "bg-primary-soft text-text" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <Icon size={16} className={active ? "text-primary" : ""} />
              {t.label}
              {count !== undefined && (
                <span
                  className={cn(
                    "ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                    active ? "bg-surface text-muted" : "bg-surface-2 text-faint",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* panel */}
      <div className="min-w-0 flex-1">
        {tab === "projects" && <ProjectsTab projects={data.projects} />}
        {tab === "team" && <TeamTab members={data.members} />}
        {tab === "automation" && (
          <AutomationTab
            projects={data.projects}
            isEnabled={isEnabled}
            onToggle={onToggle}
            pending={pending}
          />
        )}
        {tab === "appearance" && <AppearanceTab />}
      </div>
    </div>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

function ProjectsTab({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderKanban size={34} />}
        title="No projects yet"
        description="Projects hold their own workflow statuses, labels, components and automation rules."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {projects.map((p) => (
        <Card key={p.id} className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[18px]"
              style={{ backgroundColor: withAlpha(p.color, 0.14) }}
              aria-hidden
            >
              {p.icon}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">{p.name}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">
                {p.statuses.length} statuses · {p.labels.length} labels · {p.components.length} components ·{" "}
                {p.automations.length} rules
              </p>
            </div>
            <Badge color={p.color} className="ml-auto font-mono">
              {p.key}
            </Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel icon={<Workflow size={14} />} title="Workflow statuses" count={p.statuses.length} className="lg:col-span-2">
              {p.statuses.length === 0 ? (
                <Fallback>No statuses configured</Fallback>
              ) : (
                p.statuses.map((s) => {
                  const cat = categoryMeta(s.category);
                  return (
                    <span
                      key={s.id}
                      title={`${s.name} · ${cat.label}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[12px]"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                      <span className="text-[10.5px] text-faint">{cat.label}</span>
                    </span>
                  );
                })
              )}
            </Panel>

            <Panel icon={<Tag size={14} />} title="Labels" count={p.labels.length}>
              {p.labels.length === 0 ? (
                <Fallback>No labels yet</Fallback>
              ) : (
                p.labels.map((l) => (
                  <span
                    key={l.id}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium"
                    style={{
                      color: l.color,
                      backgroundColor: withAlpha(l.color, 0.13),
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                  </span>
                ))
              )}
            </Panel>

            <Panel icon={<Boxes size={14} />} title="Components" count={p.components.length}>
              {p.components.length === 0 ? (
                <Fallback>No components yet</Fallback>
              ) : (
                p.components.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center rounded-md bg-surface-2 px-2 py-1 text-[11.5px] text-muted"
                  >
                    {c.name}
                  </span>
                ))
              )}
            </Panel>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Panel({
  icon,
  title,
  count,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-surface-2/40 p-3", className)}>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-faint">{icon}</span>
        <SectionTitle>{title}</SectionTitle>
        <span className="text-[11px] tabular-nums text-faint">{count}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Fallback({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-faint">{children}</p>;
}

// ── Team ─────────────────────────────────────────────────────────────────────

function TeamTab({ members }: { members: Member[] }) {
  const sorted = React.useMemo(
    () =>
      [...members].sort((a, b) => {
        const oa = ROLE_ORDER[a.role] ?? 99;
        const ob = ROLE_ORDER[b.role] ?? 99;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      }),
    [members],
  );

  const byRole = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) map.set(m.role, (map.get(m.role) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => (ROLE_ORDER[a[0]] ?? 99) - (ROLE_ORDER[b[0]] ?? 99));
  }, [members]);

  if (members.length === 0) {
    return (
      <EmptyState
        icon={<Users size={34} />}
        title="No members yet"
        description="People invited to this workspace will show up here with their org role."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Users size={16} className="text-faint" />
        <p className="text-[13.5px] font-semibold">Workspace members</p>
        <span className="text-[12px] text-faint">{members.length}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {byRole.map(([role, count]) => (
            <Badge key={role} color={roleColor(role)} dot>
              {roleLabel(role)} {count}
            </Badge>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border">
        {sorted.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
            <Avatar user={{ name: m.name, color: m.color, avatarUrl: null }} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <p className="truncate text-[13px] font-medium">{m.name}</p>
                {m.title && <span className="hidden truncate text-[11.5px] text-faint sm:inline">{m.title}</span>}
              </div>
              <p className="truncate text-[12.5px] text-muted">{m.email}</p>
            </div>
            <Badge color={roleColor(m.role)} dot className="shrink-0">
              {roleLabel(m.role)}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Automation ───────────────────────────────────────────────────────────────

function AutomationTab({
  projects,
  isEnabled,
  onToggle,
  pending,
}: {
  projects: Project[];
  isEnabled: (a: Automation) => boolean;
  onToggle: (a: Automation) => void;
  pending: boolean;
}) {
  const all = projects.flatMap((p) => p.automations);
  const enabled = all.filter((a) => isEnabled(a)).length;
  const runs = all.reduce((sum, a) => sum + a.runCount, 0);
  const withRules = projects.filter((p) => p.automations.length > 0);

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<Zap size={34} />}
        title="No automation rules"
        description="Rules react to issue events — escalating critical bugs, routing by type, or notifying a team."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Rules" value={all.length} sub="across all projects" accent="#5b5bd6" icon={<Zap size={18} />} />
        <StatTile
          label="Enabled"
          value={enabled}
          sub={`${all.length - enabled} paused`}
          accent="#16a34a"
          icon={<ShieldCheck size={18} />}
        />
        <StatTile
          label="Total runs"
          value={runs}
          sub="lifetime executions"
          accent="#d97706"
          icon={<Activity size={18} />}
        />
      </div>

      {pending && (
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <Spinner className="h-3.5 w-3.5" />
          Saving rule…
        </p>
      )}

      {withRules.map((p) => {
        const enabledCount = p.automations.filter((a) => isEnabled(a)).length;
        return (
          <Card key={p.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[15px]"
                style={{ backgroundColor: withAlpha(p.color, 0.14) }}
                aria-hidden
              >
                {p.icon}
              </span>
              <p className="truncate text-[13.5px] font-semibold">{p.name}</p>
              <Badge color={p.color} className="font-mono">
                {p.key}
              </Badge>
              <span className="ml-auto text-[11.5px] text-faint">
                {enabledCount} of {p.automations.length} enabled
              </span>
            </div>

            <div className="divide-y divide-border">
              {p.automations.map((a) => {
                const on = isEnabled(a);
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{a.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                          {a.trigger}
                        </span>
                        <span className="text-[11.5px] text-faint tabular-nums">ran {a.runCount}x</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${on ? "Disable" : "Enable"} ${a.name}`}
                      onClick={() => onToggle(a)}
                      className={cn(
                        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                        on ? "bg-primary" : "bg-surface-3",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform",
                          on ? "translate-x-[18px]" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────

const THEME_SWATCHES = [
  {
    label: "Light",
    icon: Sun,
    bg: "#f5f6f9",
    surface: "#ffffff",
    border: "#e5e7ef",
    text: "#14161f",
    muted: "#8b90a1",
    primary: "#5b5bd6",
  },
  {
    label: "Dark",
    icon: Moon,
    bg: "#0c0d13",
    surface: "#14151d",
    border: "#262835",
    text: "#eceefb",
    muted: "#6b7085",
    primary: "#8b8bf5",
  },
];

const OPTION_ROWS: { icon: LucideIcon; title: string; description: string; values: string }[] = [
  {
    icon: Rows3,
    title: "Density",
    description: "Compact tightens padding and type scale across every table, card and list.",
    values: "Cozy · Compact",
  },
  {
    icon: Contrast,
    title: "High contrast",
    description: "Strengthens borders and text for WCAG AA legibility in both themes.",
    values: "On · Off",
  },
];

function AppearanceTab() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Sparkles size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold">Appearance lives in the top bar</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Light, Dark, Cozy, Compact and High contrast are switched from the appearance menu — the sun / moon
              icon in the top bar, next to search. Your choice is stored on this device and applies to every
              project in the workspace.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {THEME_SWATCHES.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.label}
                className="overflow-hidden rounded-lg border border-border"
                style={{ backgroundColor: t.bg }}
                aria-hidden
              >
                <div className="flex items-center gap-2 px-3 pt-3">
                  <Icon size={13} style={{ color: t.muted }} />
                  <span className="text-[11.5px] font-semibold" style={{ color: t.text }}>
                    {t.label}
                  </span>
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: withAlpha(t.primary, 0.18), color: t.primary }}
                  >
                    Theme
                  </span>
                </div>
                <div className="p-3">
                  <div
                    className="rounded-lg border p-2.5"
                    style={{ backgroundColor: t.surface, borderColor: t.border }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.primary }} />
                      <span className="h-1.5 w-16 rounded-full" style={{ backgroundColor: t.text, opacity: 0.85 }} />
                      <span className="ml-auto h-1.5 w-6 rounded-full" style={{ backgroundColor: t.muted }} />
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <span className="block h-1.5 w-full rounded-full" style={{ backgroundColor: t.border }} />
                      <span className="block h-1.5 w-4/5 rounded-full" style={{ backgroundColor: t.border }} />
                      <span className="block h-1.5 w-2/3 rounded-full" style={{ backgroundColor: t.border }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {OPTION_ROWS.map((o) => {
            const Icon = o.icon;
            return (
              <div key={o.title} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{o.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{o.description}</p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-md bg-surface-2 px-2 py-1 text-[11.5px] text-faint">
                  {o.values}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
