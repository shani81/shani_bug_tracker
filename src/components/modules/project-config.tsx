"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Star, ChevronUp, ChevronDown, TriangleAlert } from "lucide-react";
import { Badge, Button, Input, Select, Spinner } from "@/components/ui/primitives";
import {
  createStatus,
  deleteStatus,
  setDefaultStatus,
  moveStatus,
  createLabel,
  deleteLabel,
  createComponent,
  deleteComponent,
  type ActionResult,
} from "@/lib/project-actions";
import { STATUS_CATEGORIES, categoryMeta } from "@/lib/constants";
import { cn, withAlpha } from "@/lib/utils";
import type { SettingsData } from "@/lib/module-queries";

type Project = SettingsData["projects"][number];

/**
 * Editable workflow statuses, labels and components for one project.
 * Rendered inside the existing project card in Settings → Projects.
 */
export function ProjectConfig({ project }: { project: Project }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(key: string, fn: () => Promise<ActionResult | unknown>) {
    setBusy(key);
    setError(null);
    try {
      const res = (await fn()) as ActionResult | undefined;
      if (res && "ok" in res && !res.ok) setError(res.error);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
          <TriangleAlert size={14} /> {error}
        </p>
      )}

      {/* ── Statuses ─────────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          Workflow statuses
        </p>
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {project.statuses.map((s, i) => {
            const cat = categoryMeta(s.category);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
                <Badge color={cat.color}>{cat.label}</Badge>
                {s.isDefault && <Badge color="#5b5bd6">default</Badge>}

                <div className="flex shrink-0 items-center gap-0.5">
                  {busy === s.id && <Spinner className="h-3.5 w-3.5" />}
                  <IconBtn
                    label="Move up"
                    disabled={i === 0 || busy !== null}
                    onClick={() => run(s.id, () => moveStatus(s.id, "up"))}
                  >
                    <ChevronUp size={14} />
                  </IconBtn>
                  <IconBtn
                    label="Move down"
                    disabled={i === project.statuses.length - 1 || busy !== null}
                    onClick={() => run(s.id, () => moveStatus(s.id, "down"))}
                  >
                    <ChevronDown size={14} />
                  </IconBtn>
                  <IconBtn
                    label="Make default for new issues"
                    disabled={s.isDefault || busy !== null}
                    onClick={() => run(s.id, () => setDefaultStatus(s.id))}
                  >
                    <Star size={14} className={s.isDefault ? "text-primary" : ""} />
                  </IconBtn>
                  <IconBtn
                    label="Delete status"
                    danger
                    disabled={busy !== null}
                    onClick={() => run(s.id, () => deleteStatus(s.id))}
                  >
                    <X size={14} />
                  </IconBtn>
                </div>
              </div>
            );
          })}
        </div>

        <AddRow
          busy={busy === `new-status-${project.id}`}
          onSubmit={(fd) =>
            run(`new-status-${project.id}`, () =>
              createStatus({
                projectId: project.id,
                name: String(fd.get("name") ?? ""),
                category: String(fd.get("category") ?? "unstarted"),
                color: String(fd.get("color") ?? "#9095a6"),
              }),
            )
          }
        >
          <Input name="name" required placeholder="Status name" className="h-8 w-40" maxLength={40} />
          <Select name="category" defaultValue="unstarted" className="h-8 w-auto">
            {STATUS_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <input
            name="color"
            type="color"
            defaultValue="#9095a6"
            aria-label="Status colour"
            className="h-8 w-10 cursor-pointer rounded border border-border bg-surface"
          />
        </AddRow>
      </section>

      {/* ── Labels ───────────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Labels</p>
        {project.labels.length === 0 ? (
          <p className="text-[12.5px] text-faint">No labels yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {project.labels.map((l) => (
              <span
                key={l.id}
                className="group inline-flex h-7 items-center gap-1.5 rounded-full border border-border pl-2.5 pr-1 text-[12px]"
                style={{ backgroundColor: withAlpha(l.color, 0.13) }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                {l.name}
                <button
                  onClick={() => run(l.id, () => deleteLabel(l.id))}
                  disabled={busy !== null}
                  aria-label={`Delete label ${l.name}`}
                  className="grid h-5 w-5 place-items-center rounded-full text-faint opacity-0 hover:bg-surface-3 hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <AddRow
          busy={busy === `new-label-${project.id}`}
          onSubmit={(fd) =>
            run(`new-label-${project.id}`, () =>
              createLabel({
                projectId: project.id,
                name: String(fd.get("name") ?? ""),
                color: String(fd.get("color") ?? "#5b5bd6"),
              }),
            )
          }
        >
          <Input name="name" required placeholder="Label name" className="h-8 w-40" maxLength={40} />
          <input
            name="color"
            type="color"
            defaultValue="#5b5bd6"
            aria-label="Label colour"
            className="h-8 w-10 cursor-pointer rounded border border-border bg-surface"
          />
        </AddRow>
      </section>

      {/* ── Components ───────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Components</p>
        {project.components.length === 0 ? (
          <p className="text-[12.5px] text-faint">No components yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {project.components.map((c) => (
              <span
                key={c.id}
                className="group inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 pl-2.5 pr-1 text-[12px]"
              >
                {c.name}
                <button
                  onClick={() => run(c.id, () => deleteComponent(c.id))}
                  disabled={busy !== null}
                  aria-label={`Delete component ${c.name}`}
                  className="grid h-5 w-5 place-items-center rounded-full text-faint opacity-0 hover:bg-surface-3 hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <AddRow
          busy={busy === `new-component-${project.id}`}
          onSubmit={(fd) =>
            run(`new-component-${project.id}`, () =>
              createComponent({ projectId: project.id, name: String(fd.get("name") ?? "") }),
            )
          }
        >
          <Input name="name" required placeholder="Component name" className="h-8 w-48" maxLength={60} />
        </AddRow>
      </section>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-surface-2 disabled:opacity-30",
        danger ? "hover:text-danger" : "hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/** Inline "add another" form that resets itself after a successful submit. */
function AddRow({
  children,
  onSubmit,
  busy,
}: {
  children: React.ReactNode;
  onSubmit: (fd: FormData) => void | Promise<void>;
  busy: boolean;
}) {
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await onSubmit(fd);
        ref.current?.reset();
      }}
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      {children}
      <Button type="submit" size="sm" variant="secondary" disabled={busy}>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <Plus size={14} />} Add
      </Button>
    </form>
  );
}
