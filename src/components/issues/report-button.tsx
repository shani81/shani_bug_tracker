"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useQuickAdd } from "@/components/quick-add";
import { GROUP_LABELS, type IssueGroup } from "@/lib/constants";

export function ReportButton({ group }: { group: IssueGroup }) {
  const quickAdd = useQuickAdd();
  return (
    <Button variant="primary" onClick={() => quickAdd.open(group)}>
      <Plus size={16} />
      New {GROUP_LABELS[group]}
    </Button>
  );
}
