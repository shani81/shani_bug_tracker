"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission, ValidationError, AuthError } from "@/lib/permissions";
import { isThrottled, recordFailure } from "@/lib/throttle";
import { parseCsv } from "@/lib/csv";
import { createIssue } from "@/lib/actions";
import { ISSUE_TYPES, PRIORITIES, SEVERITIES, IMPACTS, ENVIRONMENTS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// CSV issue import.
//
// Always validated as a whole before anything is written, and exposed to the UI
// as a dry run first: bulk-creating issues is tedious to undo, so the user sees
// exactly what would happen before committing.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ROWS = 500;
/** Imports allowed per user per throttle window (15 minutes). */
const MAX_IMPORTS_PER_WINDOW = 25;
const MAX_BYTES = 2 * 1024 * 1024;

export type ImportRowResult = {
  row: number;
  title: string;
  ok: boolean;
  message?: string;
};

export type ImportPreview = {
  ok: boolean;
  error?: string;
  totalRows: number;
  valid: number;
  invalid: number;
  results: ImportRowResult[];
  /** column names found in the file, for the "unrecognised column" hint */
  columns: string[];
  unknownColumns: string[];
};

const KNOWN_COLUMNS = [
  "title", "type", "description", "priority", "severity", "impact",
  "environment", "expected", "actual", "steps", "url", "labels", "assignees",
];

const TYPES = new Set(ISSUE_TYPES.map((t) => t.value));
const PRIOS = new Set(PRIORITIES.map((p) => p.value));
const SEVS = new Set(SEVERITIES.map((s) => s.value));
const IMPS = new Set(IMPACTS.map((i) => i.value));
const ENVS = new Set(ENVIRONMENTS.map((e) => e.value));

const inputSchema = z.object({
  projectId: z.string().min(1),
  csv: z.string().min(1).max(MAX_BYTES),
});

type ParsedRow = {
  index: number;
  title: string;
  type: string;
  descMd: string;
  priority: string;
  severity: string;
  impact: string;
  environment: string;
  expected: string;
  actual: string;
  steps: string;
  url: string;
  labelNames: string[];
  assigneeEmails: string[];
  error?: string;
};

function normalizeRows(raw: Record<string, string>[]): ParsedRow[] {
  return raw.map((r, i) => {
    // accept a few common header spellings from other trackers
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const hit = Object.keys(r).find((c) => c.toLowerCase().replace(/[\s_-]/g, "") === k);
        if (hit && r[hit] !== "") return r[hit];
      }
      return "";
    };

    const title = get("title", "summary", "name");
    const type = (get("type", "issuetype") || "bug").toLowerCase();
    const priority = (get("priority") || "medium").toLowerCase();
    const severity = (get("severity") || "major").toLowerCase();

    const row: ParsedRow = {
      index: i + 2, // +1 for the header, +1 for 1-based display
      title,
      type,
      descMd: get("description", "descmd", "body"),
      priority,
      severity,
      impact: (get("impact") || "moderate").toLowerCase(),
      environment: (get("environment", "env") || "production").toLowerCase(),
      expected: get("expected", "expectedresult"),
      actual: get("actual", "actualresult"),
      steps: get("steps", "stepstoreproduce", "repro"),
      url: get("url", "link"),
      labelNames: get("labels", "label", "tags").split(/[\s,;]+/).filter(Boolean),
      assigneeEmails: get("assignees", "assignee").split(/[\s,;]+/).filter(Boolean),
    };

    if (!title) row.error = "Missing title";
    else if (title.length > 300) row.error = "Title exceeds 300 characters";
    else if (!TYPES.has(row.type)) row.error = `Unknown type "${row.type}"`;
    else if (!PRIOS.has(row.priority)) row.error = `Unknown priority "${row.priority}"`;
    else if (!SEVS.has(row.severity)) row.error = `Unknown severity "${row.severity}"`;
    // impact and environment were previously only lowercased, so an arbitrary
    // multi-megabyte string could be written straight through to the database
    else if (!IMPS.has(row.impact)) row.error = `Unknown impact "${row.impact.slice(0, 30)}"`;
    else if (!ENVS.has(row.environment)) row.error = `Unknown environment "${row.environment.slice(0, 30)}"`;

    return row;
  });
}

/** Validate a CSV without writing anything. */
export async function previewIssueImport(input: {
  projectId: string;
  csv: string;
}): Promise<ImportPreview> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return emptyPreview(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  await requirePermission("issue:create", { projectId: parsed.data.projectId });

  let raw: Record<string, string>[];
  try {
    raw = parseCsv(parsed.data.csv);
  } catch {
    return emptyPreview("Could not parse that file as CSV.");
  }
  if (raw.length === 0) return emptyPreview("No data rows found.");
  if (raw.length > MAX_ROWS) return emptyPreview(`Too many rows (${raw.length}). The limit is ${MAX_ROWS}.`);

  const columns = Object.keys(raw[0] ?? {});
  const unknownColumns = columns.filter(
    (c) => !KNOWN_COLUMNS.includes(c.toLowerCase().replace(/[\s_-]/g, "")),
  );

  const rows = normalizeRows(raw);
  return {
    ok: true,
    totalRows: rows.length,
    valid: rows.filter((r) => !r.error).length,
    invalid: rows.filter((r) => r.error).length,
    results: rows.map((r) => ({
      row: r.index,
      title: r.title || "(no title)",
      ok: !r.error,
      message: r.error,
    })),
    columns,
    unknownColumns,
  };
}

/** Import the valid rows. Invalid rows are skipped and reported. */
export async function runIssueImport(input: {
  projectId: string;
  csv: string;
}): Promise<ImportPreview> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return emptyPreview(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { projectId, csv } = parsed.data;
  // Bulk import is a much bigger hammer than filing one issue: require the
  // project-management capability rather than plain issue:create, so guests
  // and read-only project roles cannot mass-create.
  const ctx = await requirePermission("project:manage", { projectId });

  // Each row fans out to notifications and webhook deliveries, so an
  // unthrottled loop is an amplification primitive.
  const throttleKey = `import:${ctx.userId}`;
  if (isThrottled(throttleKey, MAX_IMPORTS_PER_WINDOW)) {
    return emptyPreview("Too many imports in a short time. Try again in a few minutes.");
  }
  recordFailure(throttleKey);

  const raw = parseCsv(csv);
  if (raw.length === 0) return emptyPreview("No data rows found.");
  if (raw.length > MAX_ROWS) return emptyPreview(`Too many rows (${raw.length}). The limit is ${MAX_ROWS}.`);

  const rows = normalizeRows(raw);

  // Resolve labels and assignees once, by name/email within this project + org.
  const [labels, project] = await Promise.all([
    prisma.label.findMany({ where: { projectId }, select: { id: true, name: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } }),
  ]);
  if (!project) throw new ValidationError("Project not found.");

  const members = await prisma.user.findMany({
    where: { orgId: project.orgId },
    select: { id: true, email: true },
  });
  const labelByName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  const userByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));

  const results: ImportRowResult[] = [];
  for (const r of rows) {
    if (r.error) {
      results.push({ row: r.index, title: r.title || "(no title)", ok: false, message: r.error });
      continue;
    }
    try {
      // Reuse createIssue so imported rows get the same validation, activity
      // trail, notifications and realtime events as anything else.
      await createIssue({
        projectId,
        type: r.type,
        title: r.title,
        descMd: r.descMd,
        expected: r.expected,
        actual: r.actual,
        steps: r.steps,
        url: r.url,
        priority: r.priority,
        severity: r.severity,
        impact: r.impact,
        environment: r.environment,
        labelIds: r.labelNames.map((n) => labelByName.get(n.toLowerCase())).filter((x): x is string => !!x),
        assigneeIds: r.assigneeEmails
          .map((e) => userByEmail.get(e.toLowerCase()))
          .filter((x): x is string => !!x),
      });
      results.push({ row: r.index, title: r.title, ok: true });
    } catch (e) {
      // Only messages we authored are safe to show: a raw Prisma error would
      // leak table names, and a connection failure the database host.
      const safe = e instanceof ValidationError || e instanceof AuthError;
      if (!safe) console.error("[import] row failed", e);
      results.push({
        row: r.index,
        title: r.title,
        ok: false,
        message: safe ? (e as Error).message.slice(0, 160) : "Could not create this issue.",
      });
    }
  }

  revalidatePath("/bugs");
  revalidatePath("/");

  return {
    ok: true,
    totalRows: rows.length,
    valid: results.filter((r) => r.ok).length,
    invalid: results.filter((r) => !r.ok).length,
    results,
    columns: Object.keys(raw[0] ?? {}),
    unknownColumns: [],
  };
}

function emptyPreview(error: string): ImportPreview {
  return { ok: false, error, totalRows: 0, valid: 0, invalid: 0, results: [], columns: [], unknownColumns: [] };
}
