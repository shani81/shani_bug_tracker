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
  UserPlus,
  MailPlus,
  KeyRound,
  Copy,
  Check,
  TriangleAlert,
  KeySquare,
  Plus,
  DatabaseZap,
  type LucideIcon,
} from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, SectionTitle, Select, Spinner } from "@/components/ui/primitives";
import { StatTile } from "@/components/dashboard/charts";
import { toggleAutomation } from "@/lib/actions";
import {
  inviteMember,
  revokeInvitation,
  changeMemberRole,
  setMemberActive,
  changeOwnPasswordAction,
  issuePasswordReset,
  type PasswordState,
} from "@/lib/team-actions";
import { createApiToken, revokeApiToken } from "@/lib/token-actions";
import { DataTab } from "@/components/modules/data-tab";
import { WebhooksPanel } from "@/components/modules/webhooks-panel";
import { ProjectConfig } from "@/components/modules/project-config";
import { categoryMeta } from "@/lib/constants";
import { cn, colorFromString, withAlpha, formatDate, relativeTime } from "@/lib/utils";
import type { SettingsData } from "@/lib/module-queries";

type Project = SettingsData["projects"][number];
type Member = SettingsData["members"][number];
type Automation = Project["automations"][number];

type Tab = "projects" | "team" | "automation" | "data" | "account" | "appearance";

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "projects", label: "Projects", icon: FolderKanban },
  { value: "team", label: "Team", icon: Users },
  { value: "automation", label: "Automation", icon: Zap },
  { value: "data", label: "Import / Export", icon: DatabaseZap },
  { value: "account", label: "Account", icon: KeyRound },
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
    team: data.members.length + data.invitations.length,
    automation: automationCount,
    data: undefined,
    account: undefined,
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
        {tab === "team" && (
          <TeamTab
            members={data.members}
            invitations={data.invitations}
            grantableRoles={data.grantableRoles}
            viewerRole={data.viewerRole}
          />
        )}
        {tab === "automation" && (
          <div className="flex flex-col gap-4">
            <WebhooksPanel webhooks={data.webhooks} projects={data.projects} />
            <AutomationTab
              projects={data.projects}
              isEnabled={isEnabled}
              onToggle={onToggle}
              pending={pending}
            />
          </div>
        )}
        {tab === "data" && <DataTab projects={data.projects} />}
        {tab === "account" && <AccountTab tokens={data.apiTokens} />}
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

          <ProjectConfig project={p} />
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

function TeamTab({
  members,
  invitations,
  grantableRoles,
  viewerRole,
}: {
  members: Member[];
  invitations: SettingsData["invitations"];
  grantableRoles: string[];
  viewerRole: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [resetLink, setResetLink] = React.useState<{ name: string; url: string } | null>(null);
  const [copiedReset, setCopiedReset] = React.useState(false);

  const canManage = grantableRoles.length > 0;

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

  /** An admin may not modify an owner or another admin; only an owner can. */
  function canEdit(m: Member): boolean {
    if (!canManage) return false;
    if (viewerRole === "owner") return true;
    return m.role !== "owner" && m.role !== "admin";
  }

  function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
        >
          <TriangleAlert size={14} /> {error}
        </p>
      )}

      {resetLink && (
        <Card className="p-3">
          <p className="mb-1.5 text-[12px] font-medium">
            Reset link for <span className="text-text">{resetLink.name}</span> — valid for 2 hours, single use.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-3 px-2 py-1.5 font-mono text-[11.5px]">
              {resetLink.url}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetLink.url);
                  setCopiedReset(true);
                  setTimeout(() => setCopiedReset(false), 1800);
                } catch {
                  /* clipboard unavailable — the value is selectable */
                }
              }}
            >
              {copiedReset ? <Check size={14} /> : <Copy size={14} />}
              {copiedReset ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResetLink(null)}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      {canManage && (
        <InvitePanel
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          grantableRoles={grantableRoles}
          onDone={() => router.refresh()}
        />
      )}

      {/* pending invitations */}
      {invitations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <MailPlus size={16} className="text-faint" />
            <p className="text-[13.5px] font-semibold">Pending invitations</p>
            <span className="text-[12px] text-faint">{invitations.length}</span>
          </div>
          <div className="divide-y divide-border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-faint">
                  <MailPlus size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{inv.email}</p>
                  <p className="truncate text-[11.5px] text-faint">
                    Invited by {inv.invitedBy} · expires {formatDate(inv.expiresAt)}
                  </p>
                </div>
                <Badge color={roleColor(inv.role)} dot className="shrink-0">
                  {roleLabel(inv.role)}
                </Badge>
                {canManage && (
                  <button
                    onClick={() => run(inv.id, () => revokeInvitation(inv.id))}
                    disabled={pending}
                    className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                  >
                    {busyId === inv.id ? <Spinner className="h-3.5 w-3.5" /> : "Revoke"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* members */}
      {members.length === 0 ? (
        <EmptyState
          icon={<Users size={34} />}
          title="No members yet"
          description="People invited to this workspace will show up here with their org role."
        />
      ) : (
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
              {canManage && (
                <Button size="sm" variant="secondary" onClick={() => setInviteOpen(true)}>
                  <UserPlus size={14} /> Invite
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y divide-border">
            {sorted.map((m) => {
              const editable = canEdit(m) && !m.isSelf;
              const busy = busyId === m.id;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2",
                    !m.isActive && "opacity-55",
                  )}
                >
                  <Avatar user={{ name: m.name, color: m.color, avatarUrl: null }} size={32} />
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="truncate text-[13px] font-medium">{m.name}</p>
                      {m.isSelf && <span className="shrink-0 text-[11px] text-faint">you</span>}
                      {!m.isActive && (
                        <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] font-medium text-muted">
                          Deactivated
                        </span>
                      )}
                      {m.title && (
                        <span className="hidden truncate text-[11.5px] text-faint sm:inline">{m.title}</span>
                      )}
                    </div>
                    <p className="truncate text-[12.5px] text-muted">{m.email}</p>
                  </div>

                  {busy && <Spinner className="h-3.5 w-3.5" />}

                  {editable ? (
                    <select
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(m.id, () => changeMemberRole(m.id, e.target.value))}
                      className="h-8 shrink-0 rounded-lg border border-border bg-surface px-2 text-[12.5px] disabled:opacity-50"
                      aria-label={`Role for ${m.name}`}
                    >
                      {/* the member's current role stays selectable even if not grantable */}
                      {[...new Set([m.role, ...grantableRoles])].map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge color={roleColor(m.role)} dot className="shrink-0">
                      {roleLabel(m.role)}
                    </Badge>
                  )}

                  {editable && (
                    <button
                      onClick={() =>
                        run(m.id, async () => {
                          const res = await issuePasswordReset(m.id);
                          if (res.ok) setResetLink({ name: m.name, url: res.url });
                          else setError(res.error);
                        })
                      }
                      disabled={pending}
                      title="Issue a password reset link"
                      className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-3 hover:text-text disabled:opacity-50"
                    >
                      Reset password
                    </button>
                  )}

                  {editable && (
                    <button
                      onClick={() => run(m.id, () => setMemberActive(m.id, !m.isActive))}
                      disabled={pending}
                      title={m.isActive ? "Deactivate account" : "Reactivate account"}
                      className={cn(
                        "shrink-0 rounded-lg px-2 py-1 text-[12px] hover:bg-surface-3 disabled:opacity-50",
                        m.isActive ? "text-muted hover:text-danger" : "text-success",
                      )}
                    >
                      {m.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Invite form — produces a shareable link (no mail delivery in this build). */
function InvitePanel({
  open,
  onOpenChange,
  grantableRoles,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grantableRoles: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function submit(fd: FormData) {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const res = await inviteMember({
        email: String(fd.get("email") ?? ""),
        name: String(fd.get("name") ?? ""),
        role: String(fd.get("role") ?? "member"),
        title: String(fd.get("title") ?? ""),
      });
      if (res.ok) {
        setLink(res.inviteUrl);
        onDone();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invitation.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserPlus size={16} className="text-faint" />
        <p className="text-[13.5px] font-semibold">Invite someone</p>
        <button
          onClick={() => {
            onOpenChange(false);
            setLink(null);
            setError(null);
          }}
          className="ml-auto rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-2"
        >
          Close
        </button>
      </div>

      <form action={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" required>
          <Input name="email" type="email" required placeholder="alex@company.com" />
        </Field>
        <Field label="Name" required>
          <Input name="name" required placeholder="Alex Rivera" />
        </Field>
        <Field label="Job title" hint="Optional">
          <Input name="title" placeholder="Backend Engineer" />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue={grantableRoles.includes("member") ? "member" : grantableRoles[0]}>
            {grantableRoles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Creating…" : "Create invite link"}
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
          <TriangleAlert size={14} /> {error}
        </p>
      )}

      {link && (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface-2/50 p-3">
          <p className="mb-1.5 text-[12px] font-medium">
            Invite ready — share this link. It expires in 7 days and can be used once.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-3 px-2 py-1.5 font-mono text-[11.5px]">
              {link}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* clipboard blocked — the text is selectable above */
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Self-service password change + personal API tokens. */
function AccountTab({ tokens }: { tokens: SettingsData["apiTokens"] }) {
  const [state, formAction] = useActionState<PasswordState, FormData>(changeOwnPasswordAction, {});

  return (
    <div className="flex flex-col gap-4">
      <ApiTokensPanel tokens={tokens} />
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound size={16} className="text-faint" />
          <p className="text-[13.5px] font-semibold">Change password</p>
        </div>
        <p className="mb-3 text-[12.5px] text-muted">
          Changing your password signs out every other device.
        </p>
        <form action={formAction} className="grid max-w-md gap-3">
          <Field label="Current password" required>
            <Input name="currentPassword" type="password" required autoComplete="current-password" />
          </Field>
          <Field label="New password" required hint="At least 8 characters">
            <Input name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
          </Field>

          {state.error && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
              <TriangleAlert size={14} /> {state.error}
            </p>
          )}
          {state.ok && (
            <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-[12.5px] text-success">
              <Check size={14} /> Password updated.
            </p>
          )}

          <div>
            <ChangePasswordButton />
          </div>
        </form>
      </Card>
    </div>
  );
}

function ChangePasswordButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending}>
      {pending ? "Updating…" : "Update password"}
    </Button>
  );
}

/** Personal API tokens. Shown once on creation, then only by prefix. */
function ApiTokensPanel({ tokens }: { tokens: SettingsData["apiTokens"] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function submit(fd: FormData) {
    setBusy(true);
    setError(null);
    setFresh(null);
    const scopes = fd.getAll("scopes").map(String);
    const days = String(fd.get("expiresInDays") ?? "");
    try {
      const res = await createApiToken({
        name: String(fd.get("name") ?? ""),
        scopes,
        expiresInDays: days ? Number(days) : null,
      });
      if (res.ok) {
        setFresh(res.token);
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await revokeApiToken(id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <KeySquare size={16} className="text-faint" />
        <p className="text-[13.5px] font-semibold">API tokens</p>
        <span className="text-[12px] text-faint">{tokens.length}</span>
        {!open && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(true)}>
            <Plus size={14} /> New token
          </Button>
        )}
      </div>
      <p className="mb-3 text-[12.5px] text-muted">
        Authenticate against the REST API with <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">Authorization: Bearer …</code>.
        A token acts as you, limited by its scopes. See the{" "}
        <a href="/docs/api" className="text-primary hover:underline">
          API reference
        </a>
        .
      </p>

      {fresh && (
        <div className="mb-3 rounded-lg border border-dashed border-success/40 bg-success/5 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-success">
            <Check size={13} /> Token created — copy it now. You won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-3 px-2 py-1.5 font-mono text-[11.5px]">
              {fresh}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fresh);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* clipboard blocked — the value is selectable */
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {open && (
        <form action={submit} className="mb-3 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input name="name" required placeholder="CI pipeline" />
          </Field>
          <Field label="Expires" hint="Optional">
            <Select name="expiresInDays" defaultValue="90">
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[12px] font-medium text-muted">Scopes</p>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="scopes" value="read" defaultChecked className="accent-[var(--primary)]" />
                read <span className="text-faint">— list and fetch</span>
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="scopes" value="write" className="accent-[var(--primary)]" />
                write <span className="text-faint">— create, update, delete</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? "Creating…" : "Create token"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
          <TriangleAlert size={14} /> {error}
        </p>
      )}

      {tokens.length === 0 ? (
        <p className="rounded-lg bg-surface-2/50 px-3 py-4 text-center text-[12.5px] text-muted">
          No API tokens yet.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {tokens.map((t) => {
            const expired = t.expiresAt && new Date(t.expiresAt).getTime() < Date.now();
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-40">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-[13px] font-medium">{t.name}</p>
                    {expired && (
                      <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] text-muted">Expired</span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11.5px] text-faint">{t.prefix}…</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {t.scopes.map((s) => (
                    <Badge key={s} color={s === "write" ? "#d97706" : "#0891b2"}>
                      {s}
                    </Badge>
                  ))}
                </div>
                <span className="shrink-0 text-[11.5px] text-faint">
                  {t.lastUsedAt ? `used ${relativeTime(t.lastUsedAt)}` : "never used"}
                </span>
                <button
                  onClick={() => revoke(t.id)}
                  disabled={busy}
                  className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            );
          })}
        </div>
      )}
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
