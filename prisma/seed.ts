import "dotenv/config";
import { randomBytes, scrypt as _scrypt } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "../src/generated/prisma/client";
import type { WorkflowStatus, Label, Component, Release, User, TestCase } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { DEFAULT_STATUSES, ISSUE_TYPES, PRIORITIES, SEVERITIES, IMPACTS } from "../src/lib/constants";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

// ── small deterministic-ish random helpers ───────────────────────────────────
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const sample = <T>(a: T[], n: number): T[] => [...a].sort(() => Math.random() - 0.5).slice(0, n);
const chance = (p: number) => Math.random() < p;
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
const key = (k: string, n: number) => `${k}-${String(n).padStart(6, "0")}`;

// scrypt password hashing, mirroring src/lib/auth.ts (kept inline so the seed
// has no dependency on server-only modules).
const scrypt = promisify(_scrypt) as (
  p: string | Buffer,
  s: string | Buffer,
  k: number,
  o: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// must stay in sync with the format written by src/lib/auth.ts
const N = 1 << 15, R = 8, P = 1, MAXMEM = 64 * 1024 * 1024;
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 64, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Shared password for every seeded demo account. */
const DEMO_PASSWORD = "demo1234";

async function wipe() {
  // delete in FK-safe order
  await prisma.invitation.deleteMany();
  await prisma.session.deleteMany();
  await prisma.testResult.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.testCase.deleteMany();
  await prisma.testPlan.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.timeLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.issueLabel.deleteMany();
  await prisma.issueAssignee.deleteMany();
  await prisma.watcher.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.savedSearch.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.release.deleteMany();
  await prisma.sprint.deleteMany();
  await prisma.workflowStatus.deleteMany();
  await prisma.label.deleteMany();
  await prisma.component.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}

// title pools per issue group for realistic data
const TITLES: Record<string, string[]> = {
  bug: [
    "Checkout button unresponsive on Safari iOS",
    "500 error when uploading avatars larger than 4MB",
    "Session expires after 2 minutes instead of 30",
    "Dark mode toggle resets on page reload",
    "Search returns duplicate results for hyphenated terms",
    "Pagination skips the last row on filtered lists",
    "Webhook retries fire twice for failed deliveries",
    "Date picker shows wrong month in AEST timezone",
    "Memory leak in the live dashboard after ~1h open",
    "CSV export truncates rows beyond 10,000",
    "Push notification deep link opens the wrong screen",
    "Race condition double-charges on rapid submit",
    "Table header misaligns when a column is frozen",
    "OAuth callback fails intermittently on first login",
    "Crash on Android 13 when opening the camera scanner",
    "API returns 200 with an empty body on rate limit",
    "Tooltip stays visible after the trigger unmounts",
    "Attachment thumbnails fail to load behind CDN",
  ],
  feature: [
    "Add saved views with shareable URLs",
    "Bulk edit priority across selected issues",
    "Slack notifications for status changes",
    "Command palette (Cmd+K) for quick navigation",
    "Custom fields on the issue form",
    "Two-factor authentication via authenticator apps",
    "Public roadmap page for customers",
    "Import issues from Jira and GitHub",
    "SLA timers with breach warnings",
    "Inline image annotations on screenshots",
  ],
  improvement: [
    "Speed up the board with virtualized columns",
    "Reduce initial JS bundle by code-splitting routes",
    "Improve empty states across list views",
    "Debounce global search to cut API calls",
    "Cache avatar images at the edge",
    "Better keyboard focus order in the report form",
    "Compress uploaded videos before storage",
    "Prefetch issue detail on row hover",
  ],
  task: [
    "Write migration guide for v2 API",
    "Add e2e tests for the release flow",
    "Document the automation rule schema",
    "Set up nightly database backups",
    "Audit color contrast for WCAG AA",
    "Rotate expiring signing certificates",
    "Draft Q3 release notes template",
  ],
};

const COMMENTS = [
  "Reproduced on staging — attaching the console output.",
  "This started after the 2.3 deploy. Likely the caching change.",
  "Assigning to the payments team, looks related to the webhook worker.",
  "Nice catch. I'll push a fix today and add a regression test.",
  "Can we get the exact steps? I can't reproduce on Chrome 126.",
  "Bumping priority — three customers reported this in the last hour.",
  "Fixed in the feature branch, moving to QA.",
  "Verified on prod after the hotfix. Closing.",
  "Duplicate of an earlier report, linking them.",
  "Adding the stack trace and the failing request payload.",
];

async function main() {
  console.log("Seeding…");
  await wipe();

  const org = await prisma.organization.create({
    data: { name: "Acme Software", slug: "acme", logoColor: "#5b5bd6" },
  });

  // orgRole drives global capabilities; projectRole refines them per project.
  const usersData = [
    { name: "Shani Jee", email: "you@shani.dev", color: "#5b5bd6", title: "Founder / QA Lead", orgRole: "owner", projectRole: "lead" },
    { name: "Leo Rossi", email: "leo@acme.dev", color: "#ec4899", title: "Engineering Manager", orgRole: "admin", projectRole: "manager" },
    { name: "Maya Chen", email: "maya@acme.dev", color: "#e5484d", title: "Senior Engineer", orgRole: "member", projectRole: "developer" },
    { name: "Diego Torres", email: "diego@acme.dev", color: "#16a34a", title: "Backend Engineer", orgRole: "member", projectRole: "developer" },
    { name: "Aisha Khan", email: "aisha@acme.dev", color: "#d97706", title: "Product Designer", orgRole: "member", projectRole: "designer" },
    { name: "Tom Becker", email: "tom@acme.dev", color: "#0891b2", title: "Mobile Engineer", orgRole: "member", projectRole: "developer" },
    { name: "Priya Nair", email: "priya@acme.dev", color: "#8b5cf6", title: "QA Engineer", orgRole: "member", projectRole: "qa" },
    { name: "Sana Ali", email: "sana@acme.dev", color: "#0d9488", title: "Support Lead", orgRole: "guest", projectRole: "viewer" },
  ];

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: User[] = [];
  const projectRoleByUser = new Map<string, string>();

  for (const u of usersData) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email.toLowerCase(),
        color: u.color,
        title: u.title,
        orgId: org.id,
        passwordHash,
      },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role: u.orgRole } });
    projectRoleByUser.set(user.id, u.projectRole);
    users.push(user);
  }
  const me = users[0];

  const projectDefs = [
    { key: "WEB", name: "Web App", icon: "🌐", color: "#5b5bd6", components: ["Checkout", "Auth", "Dashboard", "Search", "Billing"] },
    { key: "MOB", name: "Mobile App", icon: "📱", color: "#0891b2", components: ["Onboarding", "Camera", "Sync", "Notifications"] },
    { key: "PAY", name: "Payments API", icon: "💳", color: "#16a34a", components: ["Webhooks", "Ledger", "Gateway", "Refunds"] },
  ];

  const labelDefs = [
    { name: "regression", color: "#e5484d" },
    { name: "customer", color: "#d97706" },
    { name: "good first issue", color: "#16a34a" },
    { name: "needs-repro", color: "#8b5cf6" },
    { name: "backend", color: "#64748b" },
    { name: "frontend", color: "#0ea5e9" },
    { name: "design", color: "#ec4899" },
    { name: "tech-debt", color: "#a16207" },
  ];

  let totalIssues = 0;

  for (const pd of projectDefs) {
    const project = await prisma.project.create({
      data: { orgId: org.id, key: pd.key, name: pd.name, icon: pd.icon, color: pd.color },
    });

    // members — deterministic roles so RBAC behaves predictably in the demo
    for (const u of users) {
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: u.id, role: projectRoleByUser.get(u.id) ?? "developer" },
      });
    }

    // statuses
    const statuses: WorkflowStatus[] = [];
    for (const s of DEFAULT_STATUSES) {
      statuses.push(
        await prisma.workflowStatus.create({
          data: {
            projectId: project.id,
            name: s.name,
            category: s.category,
            color: s.color,
            order: s.order,
            isDefault: "isDefault" in s ? Boolean(s.isDefault) : false,
          },
        }),
      );
    }
    const statusByCat = (cat: string) => statuses.filter((s) => s.category === cat);

    // labels
    const labels: Label[] = [];
    for (const l of labelDefs) {
      labels.push(await prisma.label.create({ data: { projectId: project.id, ...l } }));
    }

    // components
    const components: Component[] = [];
    for (const c of pd.components) {
      components.push(await prisma.component.create({ data: { projectId: project.id, name: c } }));
    }

    // releases
    const releases: Release[] = [];
    releases.push(
      await prisma.release.create({
        data: { projectId: project.id, version: "2.3.0", name: "Spring release", status: "released", releaseDate: daysAgo(24), description: "Stability + performance." },
      }),
    );
    releases.push(
      await prisma.release.create({
        data: { projectId: project.id, version: "2.4.0", name: "Summer release", status: "in_progress", releaseDate: daysAgo(-10), description: "New reporting + mobile widgets." },
      }),
    );
    releases.push(
      await prisma.release.create({
        data: { projectId: project.id, version: "2.5.0", name: "Next", status: "planned", releaseDate: daysAgo(-38) },
      }),
    );

    // sprints
    const sprintA = await prisma.sprint.create({
      data: { projectId: project.id, name: `${pd.key} Sprint 14`, goal: "Burn down critical bugs", status: "active", startDate: daysAgo(4), endDate: daysAgo(-10) },
    });
    const sprintB = await prisma.sprint.create({
      data: { projectId: project.id, name: `${pd.key} Sprint 15`, goal: "Ship 2.4 features", status: "planned", startDate: daysAgo(-11), endDate: daysAgo(-25) },
    });
    const sprints = [sprintA, sprintB];

    // issues — mix of all groups so every module has content
    const perProject = pd.key === "WEB" ? 34 : pd.key === "MOB" ? 22 : 18;
    for (let n = 0; n < perProject; n++) {
      const type = pick(ISSUE_TYPES);
      const group = type.group ?? "bug";
      const title = pick(TITLES[group] ?? TITLES.bug);
      const status = pick(statuses);
      const isDone = ["done", "canceled"].includes(status.category);
      const created = daysAgo(randInt(0, 44));
      const resolvedAt = isDone ? new Date(created.getTime() + randInt(1, 20) * 86400_000) : null;
      const seq = n + 1;

      const issue = await prisma.issue.create({
        data: {
          projectId: project.id,
          number: seq,
          key: key(pd.key, seq),
          type: type.value,
          title,
          descMd:
            group === "bug"
              ? "When performing the action described below the app behaves unexpectedly. See attached logs for details."
              : "Proposed change to improve the product. Details and rationale below.",
          expected: group === "bug" ? "The action completes successfully without errors." : "",
          actual: group === "bug" ? "The action fails or produces an incorrect result." : "",
          steps: group === "bug" ? "1. Open the affected page\n2. Perform the action\n3. Observe the failure" : "",
          url: chance(0.4) ? `https://app.acme.dev/${pick(pd.components).toLowerCase()}` : "",
          priority: pick(PRIORITIES).value,
          severity: pick(SEVERITIES).value,
          impact: pick(IMPACTS).value,
          environment: pick(["production", "staging", "development"]),
          browser: pick(["Chrome 126", "Safari 17.5", "Firefox 127", "Edge 126", ""]),
          os: pick(["macOS 14.5", "Windows 11", "iOS 17.5", "Android 14", "Ubuntu 22.04"]),
          device: pick(["MacBook Pro", "iPhone 15", "Pixel 8", "Desktop", ""]),
          appVersion: pick(["2.3.0", "2.3.1", "2.4.0-beta"]),
          gitCommit: Math.random().toString(16).slice(2, 9),
          statusId: status.id,
          reporterId: pick(users).id,
          componentId: chance(0.8) ? pick(components).id : null,
          releaseId: chance(0.5) ? pick(releases).id : null,
          sprintId: chance(0.5) ? pick(sprints).id : null,
          storyPoints: chance(0.5) ? pick([1, 2, 3, 5, 8]) : null,
          estimateMin: chance(0.4) ? randInt(30, 480) : null,
          boardOrder: Date.now() + n,
          createdAt: created,
          updatedAt: resolvedAt ?? created,
          resolvedAt,
          closedAt: isDone ? resolvedAt : null,
          contextJson: JSON.stringify({
            consoleErrors: group === "bug" ? randInt(0, 5) : 0,
            networkRequests: randInt(10, 180),
            memoryMB: randInt(80, 620),
            cpuPct: randInt(3, 74),
          }),
          assignees: { create: sample(users, randInt(0, 2)).map((u) => ({ userId: u.id })) },
          labels: { create: sample(labels, randInt(0, 3)).map((l) => ({ labelId: l.id })) },
          watchers: { create: [{ userId: pick(users).id }] },
        },
      });
      totalIssues++;

      await prisma.activity.create({ data: { issueId: issue.id, actorId: issue.reporterId, verb: "created", createdAt: created } });

      // comments
      if (chance(0.6)) {
        const nComments = randInt(1, 4);
        for (let c = 0; c < nComments; c++) {
          await prisma.comment.create({
            data: {
              issueId: issue.id,
              authorId: pick(users).id,
              bodyMd: pick(COMMENTS),
              isPrivate: chance(0.2),
              createdAt: new Date(created.getTime() + (c + 1) * 3600_000),
            },
          });
        }
      }

      // time logs
      if (chance(0.4)) {
        await prisma.timeLog.create({
          data: { issueId: issue.id, userId: pick(users).id, minutes: randInt(15, 240), note: "Investigation" },
        });
      }
    }

    // ── QA: a test plan with cases + a run with results (WEB only, richer) ──
    if (pd.key === "WEB") {
      const plan = await prisma.testPlan.create({
        data: { projectId: project.id, name: "Release 2.4 Regression Suite", description: "Full regression pass before the 2.4 release." },
      });
      const caseTitles = [
        "User can sign in with email + password",
        "Checkout completes with a valid card",
        "Failed payment shows a helpful error",
        "Search returns relevant results",
        "Dark mode persists across reloads",
        "CSV export contains all filtered rows",
        "Push notification opens the correct screen",
        "Avatar upload accepts PNG under 4MB",
      ];
      const cases: TestCase[] = [];
      for (const t of caseTitles) {
        cases.push(
          await prisma.testCase.create({
            data: {
              projectId: project.id,
              planId: plan.id,
              title: t,
              kind: pick(["manual", "smoke", "regression", "acceptance"]),
              precondition: "User is logged in on a supported browser.",
              steps: "1. Navigate to the feature\n2. Perform the primary action\n3. Verify the outcome",
              expected: "The feature behaves as specified.",
              priority: pick(PRIORITIES).value,
            },
          }),
        );
      }
      const run = await prisma.testRun.create({
        data: { planId: plan.id, name: "2.4.0 RC1", runById: users[5].id, status: "in_progress", startedAt: daysAgo(2) },
      });
      for (const tc of cases) {
        await prisma.testResult.create({
          data: {
            runId: run.id,
            caseId: tc.id,
            status: pick(["pass", "pass", "pass", "fail", "blocked", "retest", "untested"]),
            note: chance(0.3) ? "Flaky on first attempt, passed on retry." : "",
          },
        });
      }
    }

    // ── automation rules ──
    await prisma.automationRule.create({
      data: {
        projectId: project.id,
        name: "Escalate critical bugs",
        trigger: "issue.created",
        condJson: JSON.stringify([{ field: "priority", op: "eq", value: "critical" }]),
        actionJson: JSON.stringify([{ type: "notify", target: "manager" }]),
        runCount: randInt(3, 40),
      },
    });
    await prisma.automationRule.create({
      data: {
        projectId: project.id,
        name: "Route payment issues",
        trigger: "issue.created",
        condJson: JSON.stringify([{ field: "type", op: "eq", value: "payment" }]),
        actionJson: JSON.stringify([{ type: "assign", target: "payments-team" }]),
        runCount: randInt(1, 15),
      },
    });

    // Advance the per-project issue counter past the rows just created.
    // Leaving it at 0 makes the very next createIssue() collide on the
    // (projectId, number) unique index.
    const highest = await prisma.issue.findFirst({
      where: { projectId: project.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { issueSeq: highest?.number ?? 0 },
    });
  }

  // notifications for the current user
  const someIssues = await prisma.issue.findMany({ take: 6, orderBy: { createdAt: "desc" } });
  const notifs = [
    { title: "Maya mentioned you", body: "Can you verify this on staging?", kind: "mention" },
    { title: "Assigned to WEB-000004", body: "Dark mode toggle resets on page reload", kind: "assigned" },
    { title: "Status changed", body: "PAY-000002 moved to QA Testing", kind: "status" },
    { title: "New comment on WEB-000009", body: "Fixed in the feature branch, moving to QA.", kind: "comment" },
    { title: "Release 2.4.0 is in progress", body: "12 issues remaining", kind: "release" },
    { title: "Welcome to Acme Software", body: "Your workspace is ready.", kind: "system" },
  ];
  for (let i = 0; i < notifs.length; i++) {
    await prisma.notification.create({
      data: {
        userId: me.id,
        ...notifs[i],
        issueId: someIssues[i]?.id ?? null,
        isRead: i > 3,
        createdAt: daysAgo(i),
      },
    });
  }

  // a saved search
  await prisma.savedSearch.create({
    data: {
      userId: me.id,
      name: "My critical bugs",
      queryJson: JSON.stringify({ group: "bug", priority: "critical", assigneeId: me.id }),
    },
  });

  console.log(`Done. ${users.length} users, ${projectDefs.length} projects, ${totalIssues} issues seeded.`);
  console.log(`All demo accounts use the password: ${DEMO_PASSWORD}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
