"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { IssueForm } from "@/components/issue-form";
import type { IssueGroup } from "@/lib/constants";
import { GROUP_LABELS } from "@/lib/constants";

type QuickAddCtx = { open: (group?: IssueGroup, projectId?: string) => void; close: () => void };
const Ctx = React.createContext<QuickAddCtx | null>(null);

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; group: IssueGroup; projectId?: string }>({
    open: false,
    group: "bug",
  });

  const open = React.useCallback((group: IssueGroup = "bug", projectId?: string) => {
    setState({ open: true, group, projectId });
  }, []);
  const close = React.useCallback(() => setState((s) => ({ ...s, open: false })), []);

  // global shortcut: "c" to create
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "c" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open("bug");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      <Modal open={state.open} onClose={close} title={`Report ${GROUP_LABELS[state.group]}`} size="lg">
        <IssueForm
          defaultGroup={state.group}
          defaultProjectId={state.projectId}
          onCancel={close}
          onCreated={close}
        />
      </Modal>
    </Ctx.Provider>
  );
}

export function useQuickAdd() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useQuickAdd must be used within QuickAddProvider");
  return ctx;
}
