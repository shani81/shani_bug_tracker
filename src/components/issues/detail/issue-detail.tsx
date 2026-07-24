"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Clock,
  Trash2,
  Check,
  Paperclip,
  Lock,
  Pin,
} from "lucide-react";
import { Avatar, Button, Textarea, Input } from "@/components/ui/primitives";
import { TypeBadge, PriorityBadge, SeverityBadge, StatusPill, LabelChip } from "@/components/badges";
import { useWorkspace } from "@/components/workspace";
import { PRIORITIES, SEVERITIES, IMPACTS, environmentLabel } from "@/lib/constants";
import {
  updateIssue,
  changeStatus,
  setAssignees,
  setLabels,
  addComment,
  toggleWatch,
  logTime,
  softDeleteIssue,
} from "@/lib/actions";
import { relativeTime, formatDateTime, formatDuration, safeJson, cn } from "@/lib/utils";
import type { IssueDetailDTO } from "@/lib/types";

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="w-24 shrink-0 pt-1 text-[12px] font-medium text-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Popover({
  trigger,
  children,
}: {
  trigger: (open: boolean, setOpen: (v: boolean) => void) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      {trigger(open, setOpen)}
      {open && (
        <div className="card animate-in absolute right-0 z-40 mt-1 max-h-64 w-56 overflow-y-auto p-1.5">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function IssueDetail({ issue }: { issue: IssueDetailDTO }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const project = ws.projects.find((p) => p.id === issue.projectId);

  const [title, setTitle] = React.useState(issue.title);
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [isPrivate, setIsPrivate] = React.useState(false);
  const [timeMin, setTimeMin] = React.useState("");
  const [timeNote, setTimeNote] = React.useState("");

  React.useEffect(() => setTitle(issue.title), [issue.title]);

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const ctx = safeJson<Record<string, unknown>>(issue.contextJson, {});
  const assigneeIds = new Set(issue.assignees.map((a) => a.id));
  const labelIds = new Set(issue.labels.map((l) => l.id));
  const totalTime = issue.timeLogs.reduce((s, t) => s + t.minutes, 0);

  function saveTitle() {
    setEditingTitle(false);
    if (title.trim() && title !== issue.title) run(() => updateIssue(issue.id, { title: title.trim() }));
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-[12.5px] text-muted">
        <Link href="/bugs" className="flex items-center gap-1 hover:text-text">
          <ArrowLeft size={14} /> Back
        </Link>
        <span className="text-faint">/</span>
        <span>{issue.projectName}</span>
        <span className="text-faint">/</span>
        <span className="font-mono">{issue.key}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* main column */}
        <div className="min-w-0 space-y-5">
          <div className="flex items-start gap-3">
            <TypeBadge type={issue.type} />
            {editingTitle ? (
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                className="text-[20px] font-semibold"
              />
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                className="flex-1 cursor-text text-[22px] font-semibold leading-snug tracking-tight hover:opacity-80"
                title="Click to edit"
              >
                {issue.title}
              </h1>
            )}
          </div>

          {/* description + repro */}
          <Section title="Description">
            <Body text={issue.descMd || "_No description provided._"} />
          </Section>

          {(issue.expected || issue.actual || issue.steps) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {issue.expected && (
                <Section title="Expected result">
                  <Body text={issue.expected} />
                </Section>
              )}
              {issue.actual && (
                <Section title="Actual result">
                  <Body text={issue.actual} />
                </Section>
              )}
              {issue.steps && (
                <div className="sm:col-span-2">
                  <Section title="Steps to reproduce">
                    <Body text={issue.steps} />
                  </Section>
                </div>
              )}
            </div>
          )}

          {/* attachments */}
          {issue.attachments.length > 0 && (
            <Section title={`Attachments (${issue.attachments.length})`}>
              <div className="flex flex-wrap gap-2">
                {issue.attachments.map((a) =>
                  a.kind === "image" && a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={a.id}
                      src={a.url}
                      alt={a.name}
                      className="h-24 w-32 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <span
                      key={a.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px]"
                    >
                      <Paperclip size={14} className="text-muted" />
                      {a.name}
                    </span>
                  ),
                )}
              </div>
            </Section>
          )}

          {/* comments */}
          <Section title={`Comments (${issue.comments.length})`}>
            <div className="space-y-4">
              {issue.comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar user={c.author} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <span className="font-semibold">{c.author.name}</span>
                      <span className="text-faint">{relativeTime(c.createdAt)}</span>
                      {c.isPinned && <Pin size={12} className="text-warning" />}
                      {c.isPrivate && (
                        <span className="flex items-center gap-1 rounded bg-surface-2 px-1.5 text-[10.5px] text-muted">
                          <Lock size={10} /> Internal
                        </span>
                      )}
                    </div>
                    <div className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13.5px]">
                      <Body text={c.bodyMd} />
                    </div>
                  </div>
                </div>
              ))}
              {issue.comments.length === 0 && (
                <p className="text-[13px] text-muted">No comments yet. Start the conversation.</p>
              )}
            </div>

            {/* add comment */}
            <div className="mt-4 rounded-lg border border-border p-3">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment… (Markdown supported)"
                className="min-h-16 border-0 bg-transparent p-0 focus:shadow-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                  <Lock size={12} /> Internal note
                </label>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!comment.trim()}
                  onClick={() =>
                    run(async () => {
                      await addComment(issue.id, comment, undefined, isPrivate);
                      setComment("");
                      setIsPrivate(false);
                    })
                  }
                >
                  Comment
                </Button>
              </div>
            </div>
          </Section>

          {/* activity */}
          <Section title="Activity">
            <ul className="space-y-2.5">
              {issue.activities.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 text-[12.5px] text-muted">
                  {a.actor ? (
                    <Avatar user={a.actor} size={20} />
                  ) : (
                    <span className="h-5 w-5 rounded-full bg-surface-3" />
                  )}
                  <span>
                    <span className="font-medium text-text">{a.actor?.name ?? "System"}</span>{" "}
                    {verbText(a)}
                  </span>
                  <span className="ml-auto text-faint">{relativeTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* sidebar */}
        <aside className="space-y-1 lg:sticky lg:top-4 lg:self-start">
          <div className="card p-3">
            <div className="flex items-center gap-2 pb-1">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => run(() => toggleWatch(issue.id))}
              >
                {issue.watching ? <EyeOff size={14} /> : <Eye size={14} />}
                {issue.watching ? "Unwatch" : "Watch"}
              </Button>
              <button
                onClick={() => {
                  if (confirm("Delete this issue?")) run(async () => {
                    await softDeleteIssue(issue.id);
                    router.push("/bugs");
                  });
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>

            <div className="divide-y divide-border">
              <Prop label="Status">
                <select
                  value={issue.status.id}
                  onChange={(e) => run(() => changeStatus(issue.id, e.target.value))}
                  className="input h-8 py-1 text-[12.5px]"
                >
                  {project?.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Prop>

              <Prop label="Priority">
                <div className="flex items-center gap-2">
                  <PriorityBadge priority={issue.priority} />
                  <select
                    value={issue.priority}
                    onChange={(e) => run(() => updateIssue(issue.id, { priority: e.target.value }))}
                    className="input ml-auto h-7 w-auto py-0.5 text-[11.5px]"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </Prop>

              <Prop label="Severity">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={issue.severity} />
                  <select
                    value={issue.severity}
                    onChange={(e) => run(() => updateIssue(issue.id, { severity: e.target.value }))}
                    className="input ml-auto h-7 w-auto py-0.5 text-[11.5px]"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </Prop>

              <Prop label="Impact">
                <select
                  value={issue.impact}
                  onChange={(e) => run(() => updateIssue(issue.id, { impact: e.target.value }))}
                  className="input h-7 py-0.5 text-[11.5px]"
                >
                  {IMPACTS.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </Prop>

              <Prop label="Assignees">
                <Popover
                  trigger={(open, setOpen) => (
                    <button
                      onClick={() => setOpen(!open)}
                      className="flex w-full items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-left text-[12.5px] hover:border-border-strong"
                    >
                      {issue.assignees.length ? (
                        issue.assignees.map((a) => (
                          <span key={a.id} className="flex items-center gap-1">
                            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: a.color }} />
                            {a.name.split(" ")[0]}
                          </span>
                        ))
                      ) : (
                        <span className="text-faint">Unassigned</span>
                      )}
                    </button>
                  )}
                >
                  {() => (
                    <>
                      {ws.members.map((m) => {
                        const on = assigneeIds.has(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              const next = on
                                ? [...assigneeIds].filter((x) => x !== m.id)
                                : [...assigneeIds, m.id];
                              run(() => setAssignees(issue.id, next));
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-surface-2"
                          >
                            <span className="h-5 w-5 rounded-full" style={{ backgroundColor: m.color }} />
                            <span className="flex-1 text-left">{m.name}</span>
                            {on && <Check size={14} className="text-primary" />}
                          </button>
                        );
                      })}
                    </>
                  )}
                </Popover>
              </Prop>

              <Prop label="Labels">
                <div className="space-y-1.5">
                  {issue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {issue.labels.map((l) => (
                        <LabelChip key={l.id} label={l} />
                      ))}
                    </div>
                  )}
                  <Popover
                    trigger={(open, setOpen) => (
                      <button
                        onClick={() => setOpen(!open)}
                        className="text-[12px] text-primary hover:underline"
                      >
                        Edit labels
                      </button>
                    )}
                  >
                    {() => (
                      <>
                        {project?.labels.map((l) => {
                          const on = labelIds.has(l.id);
                          return (
                            <button
                              key={l.id}
                              onClick={() => {
                                const next = on
                                  ? [...labelIds].filter((x) => x !== l.id)
                                  : [...labelIds, l.id];
                                run(() => setLabels(issue.id, next));
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-surface-2"
                            >
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: l.color }} />
                              <span className="flex-1 text-left">{l.name}</span>
                              {on && <Check size={14} className="text-primary" />}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </Popover>
                </div>
              </Prop>

              <Prop label="Reporter">
                <span className="flex items-center gap-2 text-[12.5px]">
                  <Avatar user={issue.reporter} size={20} />
                  {issue.reporter.name}
                </span>
              </Prop>

              {issue.componentName && <Prop label="Component">{issue.componentName}</Prop>}
              {issue.releaseVersion && <Prop label="Fix version">{issue.releaseVersion}</Prop>}
              {issue.sprintName && <Prop label="Sprint">{issue.sprintName}</Prop>}
            </div>
          </div>

          {/* environment / smart context */}
          <div className="card p-3">
            <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Smart context</p>
            <dl className="space-y-1.5 text-[12px]">
              <CtxRow k="Environment" v={environmentLabel(issue.environment)} />
              {issue.browser && <CtxRow k="Browser" v={issue.browser} />}
              {issue.os && <CtxRow k="OS" v={issue.os} />}
              {issue.device && <CtxRow k="Device" v={issue.device} />}
              {issue.appVersion && <CtxRow k="App version" v={issue.appVersion} />}
              {issue.gitCommit && <CtxRow k="Commit" v={issue.gitCommit} mono />}
              {typeof ctx.consoleErrors === "number" && <CtxRow k="Console errors" v={String(ctx.consoleErrors)} />}
              {typeof ctx.memoryMB === "number" && <CtxRow k="Memory" v={`${ctx.memoryMB} MB`} />}
              {typeof ctx.cpuPct === "number" && <CtxRow k="CPU" v={`${ctx.cpuPct}%`} />}
            </dl>
          </div>

          {/* time tracking */}
          <div className="card p-3">
            <p className="flex items-center gap-1.5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <Clock size={12} /> Time logged · {formatDuration(totalTime)}
            </p>
            {issue.timeLogs.length > 0 && (
              <ul className="mb-2 space-y-1 text-[12px] text-muted">
                {issue.timeLogs.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <span>{t.user?.name.split(" ")[0]}</span>
                    <span className="tabular-nums">{formatDuration(t.minutes)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                placeholder="min"
                value={timeMin}
                onChange={(e) => setTimeMin(e.target.value)}
                className="h-8 w-16 py-1 text-[12px]"
              />
              <Input
                placeholder="note"
                value={timeNote}
                onChange={(e) => setTimeNote(e.target.value)}
                className="h-8 flex-1 py-1 text-[12px]"
              />
              <Button
                size="sm"
                variant="subtle"
                disabled={!timeMin}
                onClick={() =>
                  run(async () => {
                    await logTime(issue.id, Number(timeMin), timeNote);
                    setTimeMin("");
                    setTimeNote("");
                  })
                }
              >
                Log
              </Button>
            </div>
          </div>

          <p className="px-1 pt-1 text-[11px] text-faint">
            Created {formatDateTime(issue.createdAt)}
            {issue.resolvedAt && <> · Resolved {formatDateTime(issue.resolvedAt)}</>}
          </p>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Body({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-text/90">{text}</div>;
}

function CtxRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-faint">{k}</dt>
      <dd className={cn("truncate", mono && "font-mono text-[11px]")}>{v}</dd>
    </div>
  );
}

function verbText(a: IssueDetailDTO["activities"][number]): string {
  switch (a.verb) {
    case "created":
      return "reported this issue";
    case "status_changed":
      return `changed status ${a.fromVal ? `from ${a.fromVal} ` : ""}to ${a.toVal}`;
    case "assigned":
      return "updated assignees";
    case "commented":
      return "commented";
    case "logged_time":
      return "logged time";
    case "updated":
      return `updated ${a.field ?? "the issue"}`;
    default:
      return a.verb.replace(/_/g, " ");
  }
}
