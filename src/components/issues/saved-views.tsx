"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Users, Plus, X, Check } from "lucide-react";
import { Button, Input, Spinner } from "@/components/ui/primitives";
import { saveView, deleteView, setViewShared, type ViewFilter } from "@/lib/view-actions";
import { cn } from "@/lib/utils";
import type { SavedViewDTO } from "@/lib/queries";

/**
 * Named filters for one module.
 *
 * The active filter lives in the parent (it drives the list); this component
 * only names it, lists what's saved, and applies one back on click.
 */
export function SavedViews({
  views,
  group,
  currentFilter,
  activeViewId,
  onApply,
}: {
  views: SavedViewDTO[];
  group: string;
  currentFilter: ViewFilter;
  activeViewId: string | null;
  onApply: (view: SavedViewDTO | null) => void;
}) {
  const router = useRouter();
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hasFilter = Object.values(currentFilter).some((v) => v && v !== "list");

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveView({ name, group, filter: currentFilter, isShared: shared });
      if (res.ok) {
        setNaming(false);
        setName("");
        setShared(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteView(id);
      if (activeViewId === id) onApply(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that view.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare(v: SavedViewDTO) {
    setBusy(true);
    try {
      await setViewShared(v.id, !v.isShared);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update sharing.");
    } finally {
      setBusy(false);
    }
  }

  if (views.length === 0 && !hasFilter) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <Bookmark size={12} /> Views
        </span>

        {activeViewId && (
          <button
            onClick={() => onApply(null)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[12px] text-muted hover:bg-surface-2"
          >
            <X size={12} /> Clear
          </button>
        )}

        {views.map((v) => {
          const active = v.id === activeViewId;
          return (
            <span
              key={v.id}
              className={cn(
                "group inline-flex h-7 items-center gap-1 rounded-full border pl-2.5 pr-1 text-[12px] transition-colors",
                active
                  ? "border-primary bg-primary-soft text-text"
                  : "border-border text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <button
                onClick={() => onApply(v)}
                className="inline-flex items-center gap-1.5"
                title={v.isShared && !v.isMine ? `Shared by ${v.authorName}` : undefined}
              >
                {v.isShared && <Users size={11} className="text-faint" aria-label="Shared" />}
                {v.name}
              </button>

              {v.isMine && (
                <>
                  <button
                    onClick={() => toggleShare(v)}
                    disabled={busy}
                    title={v.isShared ? "Make private" : "Share with the workspace"}
                    className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-faint opacity-0 hover:bg-surface-3 hover:text-text focus:opacity-100 group-hover:opacity-100"
                  >
                    <Users size={11} />
                  </button>
                  <button
                    onClick={() => remove(v.id)}
                    disabled={busy}
                    title="Delete view"
                    className="grid h-5 w-5 place-items-center rounded-full text-faint opacity-0 hover:bg-surface-3 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </>
              )}
            </span>
          );
        })}

        {hasFilter && !naming && (
          <button
            onClick={() => setNaming(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[12px] text-muted hover:border-primary hover:text-text"
          >
            <Plus size={12} /> Save this view
          </button>
        )}

        {busy && <Spinner className="h-3.5 w-3.5 text-faint" />}
      </div>

      {naming && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="Name this view…"
            className="h-8 w-56"
            maxLength={60}
          />
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Share with the workspace
          </label>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            <Check size={14} /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
