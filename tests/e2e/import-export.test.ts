import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, tokenFor, api, serverIsUp, BASE, cleanupTestArtifacts, actingAs } from "../helpers";
import { parseCsv } from "@/lib/csv";
import { previewIssueImport, runIssueImport } from "@/lib/import-actions";

let up = false;
let readTok = "";
let projectId = "";

beforeAll(async () => {
  up = await serverIsUp();
  if (!up) return;
  readTok = (await tokenFor("you@shani.dev", "read")).raw;
  const projects = await api("/api/v1/projects", readTok);
  projectId = projects.json.data[0].id;
});

afterAll(async () => {
  await cleanupTestArtifacts();
});

describe("export", () => {
  it("returns CSV with a header and a download filename", async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/api/v1/export?format=csv&projectId=${projectId}`, {
      headers: { Authorization: `Bearer ${readTok}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const text = await res.text();
    const rows = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).toContain("key");
    expect(Object.keys(rows[0])).toContain("title");
    expect(rows[0].key).toMatch(/-\d{6}$/);
  });

  it("returns JSON when asked", async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/api/v1/export?format=json&projectId=${projectId}`, {
      headers: { Authorization: `Bearer ${readTok}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues[0]).toHaveProperty("key");
  });

  it("requires a credential", async () => {
    if (!up) return;
    expect((await fetch(`${BASE}/api/v1/export`, { redirect: "manual" })).status).toBe(401);
  });

  it("does not leak another org's issues", async () => {
    if (!up) return;
    const org = await prisma.organization.create({
      data: { name: "[vitest] Exp", slug: "vitest-exp-" + Date.now(), logoColor: "#000" },
    });
    const user = await prisma.user.create({
      data: { name: "[vitest] Exp", email: `vitest-exp-${Date.now()}@x.test`, orgId: org.id },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role: "owner" } });
    const raw = "bt_" + Date.now() + Math.random().toString(36).slice(2);
    const { createHash } = await import("node:crypto");
    await prisma.apiToken.create({
      data: {
        name: "vitest",
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        prefix: raw.slice(0, 9),
        scopes: "read",
        userId: user.id,
        orgId: org.id,
      },
    });

    const res = await fetch(`${BASE}/api/v1/export?format=json`, {
      headers: { Authorization: `Bearer ${raw}` },
    });
    const body = await res.json();
    expect(body.issues).toHaveLength(0);

    await prisma.apiToken.deleteMany({ where: { orgId: org.id } });
    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});

describe("import validation (dry run)", () => {
  it("reports per-row problems without writing anything", async () => {
    const before = await prisma.issue.count();

    const csv = [
      "title,type,priority,severity",
      '"[vitest] good row",bug,high,major',
      ",bug,high,major", // missing title
      '"[vitest] bad type",notatype,high,major',
      '"[vitest] bad priority",bug,urgent,major',
    ].join("\n");

    const preview = await actingAs("you@shani.dev", () => previewIssueImport({ projectId, csv }));
    expect(preview.ok).toBe(true);
    expect(preview.totalRows).toBe(4);
    expect(preview.valid).toBe(1);
    expect(preview.invalid).toBe(3);

    const messages = preview.results.filter((r) => !r.ok).map((r) => r.message);
    expect(messages).toContain("Missing title");
    expect(messages.some((m) => m?.includes("Unknown type"))).toBe(true);
    expect(messages.some((m) => m?.includes("Unknown priority"))).toBe(true);

    // a dry run must not create anything
    expect(await prisma.issue.count()).toBe(before);
  });

  it("flags unrecognised columns instead of failing", async () => {
    const preview = await actingAs("you@shani.dev", () =>
      previewIssueImport({ projectId, csv: 'title,jira_id\n"[vitest] col",PROJ-1' }),
    );
    expect(preview.valid).toBe(1);
    expect(preview.unknownColumns).toContain("jira_id");
  });

  it("rejects an oversized file and empty input", async () => {
    const many = ["title", ...Array.from({ length: 501 }, (_, i) => `[vitest] row ${i}`)].join("\n");
    expect((await actingAs("you@shani.dev", () => previewIssueImport({ projectId, csv: many }))).ok).toBe(false);
    expect(
      (await actingAs("you@shani.dev", () => previewIssueImport({ projectId, csv: "title\n" }))).ok,
    ).toBe(false);
  });
});

describe("import execution", () => {
  it("creates issues, resolves labels and assignees, and skips bad rows", async () => {
    const label = await prisma.label.findFirst({ where: { projectId }, select: { name: true } });
    const csv = [
      "title,type,priority,severity,description,labels,assignees",
      `"[vitest] imported one",bug,high,major,"from csv","${label?.name ?? ""}",maya@acme.dev`,
      ",bug,high,major,,,", // invalid: no title
    ].join("\n");

    const res = await actingAs("you@shani.dev", () => runIssueImport({ projectId, csv }));
    expect(res.ok).toBe(true);
    expect(res.valid).toBe(1);
    expect(res.invalid).toBe(1);

    const created = await prisma.issue.findFirst({
      where: { title: "[vitest] imported one" },
      include: { labels: { include: { label: true } }, assignees: { include: { user: true } } },
    });
    expect(created).not.toBeNull();
    expect(created!.priority).toBe("high");
    expect(created!.descMd).toBe("from csv");
    if (label) expect(created!.labels[0]?.label.name).toBe(label.name);
    expect(created!.assignees[0]?.user.email).toBe("maya@acme.dev");

    // imports go through createIssue, so the audit trail is identical
    const activity = await prisma.activity.findFirst({
      where: { issueId: created!.id, verb: "created" },
    });
    expect(activity).not.toBeNull();
  });

  it("ignores unknown labels and assignees rather than failing the row", async () => {
    const csv = [
      "title,labels,assignees",
      '"[vitest] unknown refs",no-such-label,nobody@nowhere.test',
    ].join("\n");
    const res = await actingAs("you@shani.dev", () => runIssueImport({ projectId, csv }));
    expect(res.valid).toBe(1);

    const created = await prisma.issue.findFirst({
      where: { title: "[vitest] unknown refs" },
      include: { labels: true, assignees: true },
    });
    expect(created!.labels).toHaveLength(0);
    expect(created!.assignees).toHaveLength(0);
  });
});
