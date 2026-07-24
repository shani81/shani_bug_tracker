"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Wand2, X, Image as ImageIcon } from "lucide-react";
import { Button, Field, Input, Textarea, Select } from "@/components/ui/primitives";
import { useWorkspace } from "@/components/workspace";
import { createIssue, type CreateIssueInput } from "@/lib/actions";
import {
  ISSUE_TYPES,
  PRIORITIES,
  SEVERITIES,
  IMPACTS,
  ENVIRONMENTS,
  GROUP_LABELS,
  typesForGroup,
  type IssueGroup,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

type Attach = { name: string; kind: string; url: string; sizeBytes: number; mimeType: string };

function detectKind(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/json") return "json";
  if (mime.includes("zip")) return "zip";
  if (mime.startsWith("text/")) return "log";
  return "file";
}

export function IssueForm({
  defaultGroup = "bug",
  defaultProjectId,
  onCreated,
  onCancel,
  compact,
}: {
  defaultGroup?: IssueGroup;
  defaultProjectId?: string;
  onCreated?: (r: { id: string; key: string }) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [projectId, setProjectId] = React.useState(defaultProjectId ?? ws.projects[0]?.id ?? "");
  const project = ws.projects.find((p) => p.id === projectId) ?? ws.projects[0];

  const groupTypes = typesForGroup(defaultGroup);
  const [type, setType] = React.useState(groupTypes[0]?.value ?? "bug");
  const [title, setTitle] = React.useState("");
  const [priority, setPriority] = React.useState("medium");
  const [severity, setSeverity] = React.useState("major");
  const [impact, setImpact] = React.useState("moderate");
  const [environment, setEnvironment] = React.useState("production");
  const [descMd, setDescMd] = React.useState("");
  const [expected, setExpected] = React.useState("");
  const [actual, setActual] = React.useState("");
  const [steps, setSteps] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [browser, setBrowser] = React.useState("");
  const [os, setOs] = React.useState("");
  const [device, setDevice] = React.useState("");
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([]);
  const [labelIds, setLabelIds] = React.useState<string[]>([]);
  const [componentId, setComponentId] = React.useState<string>("");
  const [releaseId, setReleaseId] = React.useState<string>("");
  const [attachments, setAttachments] = React.useState<Attach[]>([]);
  const [showDetails, setShowDetails] = React.useState(!compact);
  const isBug = defaultGroup === "bug";

  // ── smart auto-detect environment ──
  function autoDetect() {
    const ua = navigator.userAgent;
    const bMatch =
      ua.match(/(Firefox|Edg|Chrome|Safari)\/([\d.]+)/) ?? [];
    const bName = bMatch[1] === "Edg" ? "Edge" : bMatch[1] ?? "Unknown";
    setBrowser(`${bName} ${bMatch[2]?.split(".")[0] ?? ""}`.trim());
    const osName = /Windows/.test(ua)
      ? "Windows"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown";
    setOs(osName);
    setDevice(/Mobi/.test(ua) ? "Mobile" : "Desktop");
    setShowDetails(true);
  }

  async function onFiles(files: FileList | File[]) {
    const arr = Array.from(files).slice(0, 8);
    const next: Attach[] = [];
    for (const f of arr) {
      if (f.size > 3_000_000) {
        // keep metadata only for large files (don't inline > 3MB as data URL)
        next.push({ name: f.name, kind: detectKind(f.type), url: "", sizeBytes: f.size, mimeType: f.type });
        continue;
      }
      const url = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(f);
      });
      next.push({ name: f.name, kind: detectKind(f.type), url, sizeBytes: f.size, mimeType: f.type });
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length) onFiles(imgs);
  }

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError("Please enter a title.");
      return;
    }
    if (!project) {
      setError("Please select a project.");
      return;
    }
    const input: CreateIssueInput = {
      projectId,
      type,
      title,
      descMd,
      expected,
      actual,
      steps,
      url,
      priority,
      severity,
      impact,
      environment,
      browser,
      os,
      device,
      assigneeIds,
      labelIds,
      componentId: componentId || null,
      releaseId: releaseId || null,
      contextJson: JSON.stringify({
        screen: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: typeof navigator !== "undefined" ? navigator.language : "",
      }),
      attachments,
    };
    startTransition(async () => {
      try {
        const res = await createIssue(input);
        onCreated?.(res);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  const typeOptions = ISSUE_TYPES;

  return (
    <div className="flex flex-col gap-4" onPaste={onPaste}>
      {/* top row: project + type */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Project" required>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {ws.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type" required>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {(["bug", "feature", "improvement", "task"] as IssueGroup[]).map((g) => (
              <optgroup key={g} label={GROUP_LABELS[g]}>
                {typeOptions
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Title" required>
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isBug ? "e.g. Checkout button unresponsive on Safari" : "Short, clear summary"}
          onKeyDown={(e) => e.key === "Enter" && e.metaKey && submit()}
        />
      </Field>

      <Field label="Description">
        <Textarea value={descMd} onChange={(e) => setDescMd(e.target.value)} placeholder="What happened? Add as much detail as you like — Markdown supported." />
      </Field>

      {isBug && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Expected result">
            <Textarea className="min-h-16" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="What should happen" />
          </Field>
          <Field label="Actual result">
            <Textarea className="min-h-16" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="What actually happens" />
          </Field>
          <Field label="Steps to reproduce" className="sm:col-span-2">
            <Textarea className="min-h-16" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"1. Go to…\n2. Click…\n3. See error"} />
          </Field>
        </div>
      )}

      {/* priority / severity / impact / environment */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {isBug && (
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Impact">
          <Select value={impact} onChange={(e) => setImpact(e.target.value)}>
            {IMPACTS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Environment">
          <Select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            {ENVIRONMENTS.map((en) => (
              <option key={en.value} value={en.value}>
                {en.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* attachments */}
      <Field label="Attachments" hint="Drag & drop, or paste a screenshot (⌘/Ctrl+V). Images, video, logs, PDFs, JSON…">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-2/50 px-4 py-5 text-center text-[12.5px] text-muted hover:border-primary"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) onFiles(e.dataTransfer.files);
          }}
        >
          <Paperclip size={16} />
          <span>Drop files or click to browse</span>
          <input type="file" multiple className="hidden" onChange={(e) => e.target.files && onFiles(e.target.files)} />
        </label>
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11.5px]">
                {a.kind === "image" ? <ImageIcon size={13} /> : <Paperclip size={13} />}
                <span className="max-w-32 truncate">{a.name}</span>
                <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="text-faint hover:text-danger">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </Field>

      {/* progressive-disclosure details */}
      <button
        type="button"
        onClick={() => setShowDetails((s) => !s)}
        className="flex items-center gap-2 self-start text-[12.5px] font-medium text-primary hover:underline"
      >
        {showDetails ? "Hide" : "Add"} details (assignees, labels, environment, component)
      </button>

      {showDetails && (
        <div className="grid gap-3 rounded-lg border border-border bg-surface-2/40 p-3 sm:grid-cols-2">
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-[12px] font-semibold text-muted">Smart context</span>
            <Button type="button" size="sm" variant="subtle" onClick={autoDetect}>
              <Wand2 size={14} /> Auto-detect
            </Button>
          </div>
          <Field label="Affected URL" className="sm:col-span-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Browser">
            <Input value={browser} onChange={(e) => setBrowser(e.target.value)} placeholder="Chrome 126" />
          </Field>
          <Field label="OS">
            <Input value={os} onChange={(e) => setOs(e.target.value)} placeholder="macOS 14" />
          </Field>
          <Field label="Device">
            <Input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Desktop" />
          </Field>
          <Field label="Component">
            <Select value={componentId} onChange={(e) => setComponentId(e.target.value)}>
              <option value="">None</option>
              {project?.components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fix version / release">
            <Select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
              <option value="">None</option>
              {project?.releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-[12.5px] font-medium text-muted">Assignees</span>
            <div className="flex flex-wrap gap-1.5">
              {ws.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAssigneeIds((l) => toggle(l, m.id))}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px]",
                    assigneeIds.includes(m.id)
                      ? "border-primary bg-primary-soft text-text"
                      : "border-border text-muted hover:border-border-strong",
                  )}
                >
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: m.color }} />
                  {m.name.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-[12.5px] font-medium text-muted">Labels</span>
            <div className="flex flex-wrap gap-1.5">
              {project?.labels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLabelIds((list) => toggle(list, l.id))}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11.5px]",
                    labelIds.includes(l.id) ? "border-transparent" : "border-border text-muted hover:border-border-strong",
                  )}
                  style={
                    labelIds.includes(l.id)
                      ? { color: l.color, backgroundColor: `color-mix(in srgb, ${l.color} 16%, transparent)` }
                      : undefined
                  }
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Creating…" : `Create ${GROUP_LABELS[defaultGroup]}`}
        </Button>
      </div>
    </div>
  );
}
