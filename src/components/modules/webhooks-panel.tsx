"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Webhook, Plus, Check, Copy, TriangleAlert, Send, X } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select, Spinner } from "@/components/ui/primitives";
import {
  createWebhook,
  deleteWebhook,
  setWebhookEnabled,
  testWebhook,
  type TestResult,
} from "@/lib/webhook-actions";
import { relativeTime, cn } from "@/lib/utils";
import type { SettingsData } from "@/lib/module-queries";

const EVENTS = [
  { value: "issue.created", label: "Issue created" },
  { value: "issue.updated", label: "Issue updated" },
  { value: "status.changed", label: "Status changed" },
  { value: "comment.created", label: "Comment added" },
  { value: "issue.deleted", label: "Issue deleted" },
];

export function WebhooksPanel({
  webhooks,
  projects,
}: {
  webhooks: SettingsData["webhooks"];
  projects: SettingsData["projects"];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [tested, setTested] = React.useState<Record<string, TestResult>>({});

  async function submit(fd: FormData) {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const events = fd.getAll("events").map(String);
      const projectId = String(fd.get("projectId") ?? "");
      const res = await createWebhook({
        name: String(fd.get("name") ?? ""),
        url: String(fd.get("url") ?? ""),
        projectId: projectId || null,
        events,
      });
      if (res.ok) {
        setSecret(res.secret);
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <Webhook size={16} className="text-faint" />
        <p className="text-[13.5px] font-semibold">Webhooks</p>
        <span className="text-[12px] text-faint">{webhooks.length}</span>
        {!open && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(true)}>
            <Plus size={14} /> Add webhook
          </Button>
        )}
      </div>
      <p className="mb-3 text-[12.5px] text-muted">
        POSTs a JSON payload when things happen. Each request carries{" "}
        <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">X-BugTracker-Signature</code> —
        an HMAC-SHA256 of <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">timestamp.body</code>{" "}
        — so your receiver can verify the payload is genuine and not replayed.
      </p>

      {secret && (
        <div className="mb-3 rounded-lg border border-dashed border-success/40 bg-success/5 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-success">
            <Check size={13} /> Signing secret — copy it now, it isn&apos;t shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-3 px-2 py-1.5 font-mono text-[11.5px]">
              {secret}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* clipboard unavailable — the value is selectable */
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
            <Input name="name" required placeholder="Slack relay" />
          </Field>
          <Field label="Endpoint URL" required>
            <Input name="url" required placeholder="https://example.com/hooks/bugs" />
          </Field>
          <Field label="Scope">
            <Select name="projectId" defaultValue="">
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[12px] font-medium text-muted">Events</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {EVENTS.map((e) => (
                <label key={e.value} className="flex items-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    name="events"
                    value={e.value}
                    defaultChecked={e.value !== "issue.deleted"}
                    className="accent-[var(--primary)]"
                  />
                  {e.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? "Creating…" : "Create webhook"}
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

      {webhooks.length === 0 ? (
        <p className="rounded-lg bg-surface-2/50 px-3 py-4 text-center text-[12.5px] text-muted">
          No webhooks yet.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {webhooks.map((h) => {
            const t = tested[h.id];
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", h.isEnabled ? "bg-success" : "bg-surface-3")}
                  title={h.isEnabled ? "Enabled" : "Disabled"}
                />
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-[13px] font-medium">{h.name}</p>
                    <span className="shrink-0 text-[11px] text-faint">{h.projectName ?? "all projects"}</span>
                  </div>
                  <p className="truncate font-mono text-[11.5px] text-faint">{h.url}</p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-1">
                  {h.events.map((e) => (
                    <Badge key={e} color="#64748b">
                      {e.replace("issue.", "")}
                    </Badge>
                  ))}
                </div>

                <span className="shrink-0 text-[11.5px] text-faint">
                  {h.lastFiredAt ? (
                    <>
                      {h.lastError ? (
                        <span className="text-danger" title={h.lastError}>
                          failed
                        </span>
                      ) : (
                        <span className="text-success">{h.lastStatus}</span>
                      )}{" "}
                      · {relativeTime(h.lastFiredAt)}
                    </>
                  ) : (
                    "never fired"
                  )}
                </span>

                {t && (
                  <span className={cn("shrink-0 text-[11.5px]", t.ok ? "text-success" : "text-danger")}>
                    {t.ok ? `ping ${t.status} in ${t.durationMs}ms` : t.error}
                  </span>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {busyId === h.id && <Spinner className="h-3.5 w-3.5" />}
                  <button
                    onClick={() =>
                      run(h.id, async () => {
                        const res = await testWebhook(h.id);
                        setTested((prev) => ({ ...prev, [h.id]: res }));
                      })
                    }
                    disabled={busyId === h.id}
                    title="Send a test delivery"
                    className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
                  >
                    <Send size={13} />
                  </button>
                  <button
                    onClick={() => run(h.id, () => setWebhookEnabled(h.id, !h.isEnabled))}
                    disabled={busyId === h.id}
                    className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
                  >
                    {h.isEnabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => run(h.id, () => deleteWebhook(h.id))}
                    disabled={busyId === h.id}
                    title="Delete"
                    className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
