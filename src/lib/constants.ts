// ─────────────────────────────────────────────────────────────────────────────
// App-level constants that back the String columns in the Prisma schema.
// Single source of truth for issue types, priorities, severities, statuses, etc.
// ─────────────────────────────────────────────────────────────────────────────

export type Meta = {
  value: string;
  label: string;
  color: string;
  icon?: string;
  /** which product module this belongs to */
  group?: IssueGroup;
  /** ranking for sorting (lower = more urgent / earlier) */
  rank?: number;
  description?: string;
};

export type IssueGroup = "bug" | "feature" | "improvement" | "task";

// ── Issue types ──────────────────────────────────────────────────────────────

export const ISSUE_TYPES: Meta[] = [
  { value: "bug", label: "Bug", icon: "🐞", color: "#e5484d", group: "bug" },
  { value: "error", label: "Error", icon: "❗", color: "#e5484d", group: "bug" },
  { value: "crash", label: "Crash", icon: "💥", color: "#dc2626", group: "bug" },
  { value: "security", label: "Security Issue", icon: "🔐", color: "#b91c1c", group: "bug" },
  { value: "performance", label: "Performance", icon: "🐌", color: "#d97706", group: "bug" },
  { value: "ui", label: "UI Problem", icon: "🎨", color: "#8b5cf6", group: "bug" },
  { value: "ux", label: "UX Problem", icon: "🧭", color: "#8b5cf6", group: "bug" },
  { value: "accessibility", label: "Accessibility", icon: "♿", color: "#0891b2", group: "bug" },
  { value: "database", label: "Database", icon: "🗄️", color: "#0d9488", group: "bug" },
  { value: "api", label: "API", icon: "🔌", color: "#0ea5e9", group: "bug" },
  { value: "integration", label: "Integration", icon: "🧩", color: "#0ea5e9", group: "bug" },
  { value: "payment", label: "Payment", icon: "💳", color: "#16a34a", group: "bug" },
  { value: "mobile", label: "Mobile", icon: "📱", color: "#6366f1", group: "bug" },
  { value: "desktop", label: "Desktop", icon: "🖥️", color: "#6366f1", group: "bug" },
  { value: "website", label: "Website", icon: "🌐", color: "#6366f1", group: "bug" },
  { value: "backend", label: "Backend", icon: "⚙️", color: "#64748b", group: "bug" },
  { value: "infrastructure", label: "Infrastructure", icon: "🏗️", color: "#64748b", group: "bug" },
  { value: "feature", label: "Feature Request", icon: "✨", color: "#5b5bd6", group: "feature" },
  { value: "improvement", label: "Improvement", icon: "📈", color: "#7c6ff0", group: "improvement" },
  { value: "suggestion", label: "Suggestion", icon: "💡", color: "#f59e0b", group: "improvement" },
  { value: "task", label: "Task", icon: "✅", color: "#3b82f6", group: "task" },
  { value: "documentation", label: "Documentation", icon: "📚", color: "#0d9488", group: "task" },
  { value: "other", label: "Other", icon: "📌", color: "#9095a6", group: "bug" },
];

// ── Priority ─────────────────────────────────────────────────────────────────

export const PRIORITIES: Meta[] = [
  { value: "critical", label: "Critical", icon: "🔴", color: "#dc2626", rank: 0 },
  { value: "highest", label: "Highest", icon: "🟠", color: "#ea580c", rank: 1 },
  { value: "high", label: "High", icon: "🟡", color: "#d97706", rank: 2 },
  { value: "medium", label: "Medium", icon: "🟢", color: "#16a34a", rank: 3 },
  { value: "low", label: "Low", icon: "🔵", color: "#2563eb", rank: 4 },
  { value: "lowest", label: "Lowest", icon: "⚪", color: "#64748b", rank: 5 },
];

// ── Severity ─────────────────────────────────────────────────────────────────

export const SEVERITIES: Meta[] = [
  { value: "blocker", label: "Blocker", color: "#dc2626", rank: 0 },
  { value: "critical", label: "Critical", color: "#ea580c", rank: 1 },
  { value: "major", label: "Major", color: "#d97706", rank: 2 },
  { value: "minor", label: "Minor", color: "#2563eb", rank: 3 },
  { value: "cosmetic", label: "Cosmetic", color: "#64748b", rank: 4 },
];

// ── Impact ───────────────────────────────────────────────────────────────────

export const IMPACTS: Meta[] = [
  { value: "extensive", label: "Extensive", color: "#dc2626", rank: 0 },
  { value: "significant", label: "Significant", color: "#ea580c", rank: 1 },
  { value: "moderate", label: "Moderate", color: "#d97706", rank: 2 },
  { value: "minor", label: "Minor", color: "#2563eb", rank: 3 },
  { value: "tangential", label: "Tangential", color: "#64748b", rank: 4 },
];

// ── Status categories (drive kanban columns + analytics) ─────────────────────

export const STATUS_CATEGORIES: Meta[] = [
  { value: "backlog", label: "Backlog", color: "#9095a6", rank: 0 },
  { value: "unstarted", label: "To Do", color: "#64748b", rank: 1 },
  { value: "started", label: "In Progress", color: "#d97706", rank: 2 },
  { value: "testing", label: "In Review / QA", color: "#8b5cf6", rank: 3 },
  { value: "done", label: "Done", color: "#16a34a", rank: 4 },
  { value: "canceled", label: "Canceled", color: "#9095a6", rank: 5 },
];

/** Default status set created for every new project. */
export const DEFAULT_STATUSES = [
  { name: "Backlog", category: "backlog", color: "#9095a6", order: 0 },
  { name: "Open", category: "unstarted", color: "#64748b", order: 1, isDefault: true },
  { name: "Confirmed", category: "unstarted", color: "#475569", order: 2 },
  { name: "In Progress", category: "started", color: "#d97706", order: 3 },
  { name: "In Review", category: "testing", color: "#8b5cf6", order: 4 },
  { name: "QA Testing", category: "testing", color: "#7c3aed", order: 5 },
  { name: "Ready to Release", category: "testing", color: "#0891b2", order: 6 },
  { name: "Done", category: "done", color: "#16a34a", order: 7 },
  { name: "Closed", category: "done", color: "#15803d", order: 8 },
  { name: "Won't Fix", category: "canceled", color: "#9095a6", order: 9 },
  { name: "Duplicate", category: "canceled", color: "#9095a6", order: 10 },
] as const;

// ── Environment ──────────────────────────────────────────────────────────────

export const ENVIRONMENTS: Meta[] = [
  { value: "production", label: "Production", color: "#dc2626" },
  { value: "staging", label: "Staging", color: "#d97706" },
  { value: "development", label: "Development", color: "#2563eb" },
  { value: "local", label: "Local", color: "#64748b" },
];

// ── Roles ────────────────────────────────────────────────────────────────────

export const PROJECT_ROLES: Meta[] = [
  { value: "lead", label: "Lead", color: "#5b5bd6" },
  { value: "developer", label: "Developer", color: "#2563eb" },
  { value: "qa", label: "QA", color: "#8b5cf6" },
  { value: "designer", label: "Designer", color: "#ec4899" },
  { value: "manager", label: "Manager", color: "#16a34a" },
  { value: "support", label: "Support", color: "#0891b2" },
  { value: "viewer", label: "Viewer", color: "#64748b" },
];

// ── Test result / QA statuses ────────────────────────────────────────────────

export const TEST_RESULT_STATUSES: Meta[] = [
  { value: "pass", label: "Pass", icon: "✓", color: "#16a34a" },
  { value: "fail", label: "Fail", icon: "✕", color: "#dc2626" },
  { value: "blocked", label: "Blocked", icon: "⊘", color: "#d97706" },
  { value: "retest", label: "Retest", icon: "↻", color: "#8b5cf6" },
  { value: "untested", label: "Untested", icon: "•", color: "#9095a6" },
];

export const TEST_KINDS: Meta[] = [
  { value: "manual", label: "Manual", color: "#2563eb" },
  { value: "smoke", label: "Smoke", color: "#0891b2" },
  { value: "regression", label: "Regression", color: "#d97706" },
  { value: "acceptance", label: "Acceptance", color: "#16a34a" },
  { value: "automation", label: "Automation", color: "#8b5cf6" },
];

// ── Release / sprint statuses ────────────────────────────────────────────────

export const RELEASE_STATUSES: Meta[] = [
  { value: "planned", label: "Planned", color: "#64748b" },
  { value: "in_progress", label: "In Progress", color: "#d97706" },
  { value: "released", label: "Released", color: "#16a34a" },
  { value: "rolled_back", label: "Rolled Back", color: "#dc2626" },
];

export const SPRINT_STATUSES: Meta[] = [
  { value: "planned", label: "Planned", color: "#64748b" },
  { value: "active", label: "Active", color: "#16a34a" },
  { value: "completed", label: "Completed", color: "#5b5bd6" },
];

// ── Product modules (sidebar navigation) ─────────────────────────────────────

export type NavItem = {
  href: string;
  label: string;
  icon: string; // lucide-react icon name
  group?: IssueGroup;
  badgeKey?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/bugs", label: "Bug Tracker", icon: "Bug", group: "bug", badgeKey: "bug" },
  { href: "/features", label: "Feature Requests", icon: "Sparkles", group: "feature", badgeKey: "feature" },
  { href: "/improvements", label: "Improvements", icon: "TrendingUp", group: "improvement", badgeKey: "improvement" },
  { href: "/tasks", label: "Tasks", icon: "CircleCheck", group: "task", badgeKey: "task" },
  { href: "/qa", label: "QA Testing", icon: "FlaskConical" },
  { href: "/releases", label: "Releases", icon: "Rocket" },
  { href: "/roadmap", label: "Roadmap", icon: "Map" },
  { href: "/sprints", label: "Sprint Planning", icon: "Gauge" },
  { href: "/analytics", label: "Analytics", icon: "ChartColumn" },
  { href: "/notifications", label: "Notifications", icon: "Bell" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

// ── Lookup helpers ───────────────────────────────────────────────────────────

function toMap(list: Meta[]): Record<string, Meta> {
  return Object.fromEntries(list.map((m) => [m.value, m]));
}

export const ISSUE_TYPE_MAP = toMap(ISSUE_TYPES);
export const PRIORITY_MAP = toMap(PRIORITIES);
export const SEVERITY_MAP = toMap(SEVERITIES);
export const IMPACT_MAP = toMap(IMPACTS);
export const STATUS_CATEGORY_MAP = toMap(STATUS_CATEGORIES);
export const ENVIRONMENT_MAP = toMap(ENVIRONMENTS);
export const PROJECT_ROLE_MAP = toMap(PROJECT_ROLES);
export const TEST_RESULT_MAP = toMap(TEST_RESULT_STATUSES);
export const TEST_KIND_MAP = toMap(TEST_KINDS);

export function typeMeta(v: string): Meta {
  return ISSUE_TYPE_MAP[v] ?? { value: v, label: v, color: "#9095a6", icon: "📌" };
}
export function priorityMeta(v: string): Meta {
  return PRIORITY_MAP[v] ?? { value: v, label: v, color: "#9095a6" };
}
export function severityMeta(v: string): Meta {
  return SEVERITY_MAP[v] ?? { value: v, label: v, color: "#9095a6" };
}
export function categoryMeta(v: string): Meta {
  return STATUS_CATEGORY_MAP[v] ?? { value: v, label: v, color: "#9095a6" };
}
export function environmentLabel(v: string): string {
  return ENVIRONMENT_MAP[v]?.label ?? v;
}

/** Issue types that belong to a given product module group. */
export function typesForGroup(group: IssueGroup): Meta[] {
  return ISSUE_TYPES.filter((t) => t.group === group);
}
export function typeValuesForGroup(group: IssueGroup): string[] {
  return typesForGroup(group).map((t) => t.value);
}

export const GROUP_LABELS: Record<IssueGroup, string> = {
  bug: "Bug",
  feature: "Feature Request",
  improvement: "Improvement",
  task: "Task",
};
