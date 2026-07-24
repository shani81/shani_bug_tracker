"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useQuickAdd } from "@/components/quick-add";
import { useCan } from "@/components/workspace";
import { GROUP_LABELS, type IssueGroup } from "@/lib/constants";

export function ReportButton({ group }: { group: IssueGroup }) {
  const quickAdd = useQuickAdd();
  const canCreate = useCan("issue:create");
  if (!canCreate) return null;
  return (
    <Button variant="primary" onClick={() => quickAdd.open(group)}>
      <Plus size={16} />
      New {GROUP_LABELS[group]}
    </Button>
  );
}
