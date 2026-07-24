"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/primitives";
import { PriorityBadge } from "@/components/badges";
import { TEST_RESULT_STATUSES, TEST_KINDS, type Meta } from "@/lib/constants";
import { setTestResultStatus } from "@/lib/actions";
import { cn, withAlpha, colorFromString } from "@/lib/utils";
import type { TestPlanData, TestCaseData } from "@/lib/module-queries";

/** The statuses a tester can record from the row (everything except "untested"). */
const ACTION_STATUSES = TEST_RESULT_STATUSES.filter((s) => s.value !== "untested");

const UNKNOWN_STATUS: Meta = { value: "untested", label: "Untested", color: "#9095a6", icon: "•" };

function resultMeta(value: string): Meta {
  return TEST_RESULT_STATUSES.find((s) => s.value === value) ?? { ...UNKNOWN_STATUS, value, label: value };
}
function kindMeta(value: string): Meta {
  return TEST_KINDS.find((k) => k.value === value) ?? { value, label: value, color: "#9095a6" };
}

export function QAView({ plans }: { plans: TestPlanData[] }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [busyCaseId, setBusyCaseId] = React.useState<string | null>(null);

  function record(planId: string, caseId: string, status: string) {
    setBusyCaseId(caseId);
    startTransition(async () => {
      await setTestResultStatus(planId, caseId, status);
      router.refresh();
      setBusyCaseId(null);
    });
  }

  if (plans.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical size={30} />}
        title="No test plans yet"
        description="Test plans and their cases appear here once your projects define QA coverage."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          busyCaseId={isPending ? busyCaseId : null}
          onRecord={(caseId, status) => record(plan.id, caseId, status)}
        />
      ))}
    </div>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  busyCaseId,
  onRecord,
}: {
  plan: TestPlanData;
  busyCaseId: string | null;
  onRecord: (caseId: string, status: string) => void;
}) {
  const total = plan.cases.length;
  const executed = total - (plan.summary["untested"] ?? 0);
  const passed = plan.summary["pass"] ?? 0;
  const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold leading-tight">{plan.name}</h2>
            <Badge color={colorFromString(plan.projectKey)}>{plan.projectKey}</Badge>
          </div>
          {plan.description && <p className="mt-1 text-[12.5px] text-muted">{plan.description}</p>}
        </div>

        {/* summary strip */}
        <div className="flex flex-wrap items-center gap-1.5">
          {TEST_RESULT_STATUSES.map((s) => {
            const count = plan.summary[s.value] ?? 0;
            return (
              <span
                key={s.value}
                title={`${count} ${s.label.toLowerCase()}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                  count === 0 && "opacity-45",
                )}
                style={{ color: s.color, backgroundColor: withAlpha(s.color, 0.14) }}
              >
                <span aria-hidden>{s.icon}</span>
                {s.label}
                <span className="font-semibold tabular-nums">{count}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* execution bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
          {TEST_RESULT_STATUSES.map((s) => {
            const count = plan.summary[s.value] ?? 0;
            if (!count || !total) return null;
            return (
              <span
                key={s.value}
                title={`${s.label}: ${count}`}
                style={{ width: `${(count / total) * 100}%`, backgroundColor: s.color }}
              />
            );
          })}
        </div>
        <span className="shrink-0 text-[11.5px] text-faint">
          {executed}/{total} executed · <span className="font-semibold text-muted">{passRate}%</span> pass
        </span>
      </div>

      {/* cases */}
      <div className="divide-y divide-border">
        {plan.cases.map((c) => (
          <CaseRow key={c.id} testCase={c} busy={busyCaseId === c.id} onRecord={onRecord} />
        ))}
        {total === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-muted">This plan has no test cases yet.</p>
        )}
      </div>
    </Card>
  );
}

// ── Case row ─────────────────────────────────────────────────────────────────

function CaseRow({
  testCase: c,
  busy,
  onRecord,
}: {
  testCase: TestCaseData;
  busy: boolean;
  onRecord: (caseId: string, status: string) => void;
}) {
  const current = resultMeta(c.latestStatus);
  const kind = kindMeta(c.kind);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors hover:bg-surface-2">
      {/* current result marker */}
      <span
        title={`Latest result: ${current.label}`}
        aria-label={`Latest result: ${current.label}`}
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: current.color }}
      />

      <Badge color={kind.color}>{kind.label}</Badge>
      <PriorityBadge priority={c.priority} />

      <span className="min-w-0 flex-1 basis-40 truncate text-[13px] font-medium" title={c.title}>
        {c.title}
      </span>

      {c.precondition && (
        <span className="hidden max-w-[180px] truncate text-[12px] text-faint xl:block" title={c.precondition}>
          {c.precondition}
        </span>
      )}
      {c.steps && (
        <span className="hidden max-w-[220px] truncate text-[12px] text-faint lg:block" title={c.steps}>
          {c.steps}
        </span>
      )}

      {/* segmented control — wraps below the title on small screens */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {busy && <Spinner className="h-3.5 w-3.5 text-muted" />}
        <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface">
          {ACTION_STATUSES.map((s, i) => {
            const active = c.latestStatus === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onRecord(c.id, s.value)}
                disabled={busy}
                aria-pressed={active}
                title={`Mark as ${s.label}${c.expected ? ` · Expected: ${c.expected}` : ""}`}
                className={cn(
                  "h-7 px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50",
                  i > 0 && "border-l border-border",
                  !active && "text-muted hover:bg-surface-2 hover:text-text",
                )}
                style={active ? { color: s.color, backgroundColor: withAlpha(s.color, 0.16) } : undefined}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
