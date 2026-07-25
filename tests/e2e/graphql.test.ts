import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, tokenFor, serverIsUp, BASE, cleanupTestArtifacts } from "../helpers";

let up = false;
let readTok = "";
let writeTok = "";
let projectId = "";
let sampleIssueId = "";

/** POST a GraphQL document with the given bearer token. */
async function gql(query: string, token?: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    redirect: "manual",
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  up = await serverIsUp();
  if (!up) return;
  readTok = (await tokenFor("you@shani.dev", "read")).raw;
  writeTok = (await tokenFor("you@shani.dev", "read,write")).raw;

  const projects = await gql("{ projects { id key } }", readTok);
  projectId = projects.json.data.projects[0].id;
  const issues = await gql("{ issues(filter: { limit: 1 }) { nodes { id } } }", readTok);
  sampleIssueId = issues.json.data.issues.nodes[0].id;
});

afterAll(async () => {
  await cleanupTestArtifacts();
});

describe("authentication", () => {
  it("rejects missing and bogus tokens", async () => {
    if (!up) return;
    expect((await gql("{ me { id } }")).status).toBe(401);
    expect((await gql("{ me { id } }", "bt_not-a-real-token")).status).toBe(401);
  });

  it("returns identity and capabilities", async () => {
    if (!up) return;
    const res = await gql("{ me { email orgRole scopes capabilities } }", readTok);
    expect(res.status).toBe(200);
    expect(res.json.data.me.email).toBe("you@shani.dev");
    expect(res.json.data.me.orgRole).toBe("owner");
    expect(res.json.data.me.scopes).toEqual(["read"]);
    expect(res.json.data.me.capabilities).toContain("issue:create");
  });
});

describe("queries", () => {
  it("lists projects with their statuses", async () => {
    if (!up) return;
    const res = await gql("{ projects { id key name statuses { id name category } } }", readTok);
    expect(res.json.data.projects.length).toBeGreaterThan(0);
    expect(res.json.data.projects[0].statuses.length).toBeGreaterThan(0);
  });

  it("paginates issues and reports a real total", async () => {
    if (!up) return;
    const res = await gql(
      "{ issues(filter: { limit: 3, offset: 0 }) { nodes { id key title } total hasMore } }",
      readTok,
    );
    expect(res.json.data.issues.nodes).toHaveLength(3);
    expect(res.json.data.issues.total).toBeGreaterThan(3);
    expect(res.json.data.issues.hasMore).toBe(true);

    const page2 = await gql("{ issues(filter: { limit: 3, offset: 3 }) { nodes { id } } }", readTok);
    const ids1 = res.json.data.issues.nodes.map((n: any) => n.id);
    const ids2 = page2.json.data.issues.nodes.map((n: any) => n.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("filters by group", async () => {
    if (!up) return;
    const res = await gql('{ issues(filter: { group: "bug", limit: 5 }) { nodes { type } } }', readTok);
    expect(res.json.data.issues.nodes.length).toBeGreaterThan(0);
  });

  it("fetches one issue with comments", async () => {
    if (!up) return;
    const res = await gql(
      `{ issue(id: "${sampleIssueId}") { key title status { name } comments { id bodyMd } } }`,
      readTok,
    );
    expect(res.json.data.issue.key).toMatch(/-\d{6}$/);
    expect(Array.isArray(res.json.data.issue.comments)).toBe(true);
  });
});

describe("scope enforcement", () => {
  // The guarantee has to hold on this surface too, not just REST.
  it("refuses every mutation for a read-only token", async () => {
    if (!up) return;
    const mutations = [
      `mutation { createIssue(input: { projectId: "${projectId}", title: "[vitest] gql" }) { id } }`,
      `mutation { updateIssue(id: "${sampleIssueId}", input: { title: "[vitest] hijacked" }) { id } }`,
      `mutation { deleteIssue(id: "${sampleIssueId}") }`,
      `mutation { addComment(issueId: "${sampleIssueId}", body: "nope") { id } }`,
    ];
    for (const m of mutations) {
      const res = await gql(m, readTok);
      expect(res.json.errors?.[0]?.message ?? "", m.slice(0, 40)).toMatch(/read-only/i);
    }
  });

  it("leaves data untouched after a denied mutation", async () => {
    if (!up) return;
    const res = await gql(`{ issue(id: "${sampleIssueId}") { title } }`, readTok);
    expect(res.json.data.issue.title).not.toBe("[vitest] hijacked");
  });
});

describe("mutations", () => {
  it("creates, updates, transitions, comments on and deletes an issue", async () => {
    if (!up) return;

    const created = await gql(
      `mutation { createIssue(input: { projectId: "${projectId}", title: "[vitest] graphql issue", type: "bug", priority: "high" }) { id key title priority } }`,
      writeTok,
    );
    expect(created.json.errors).toBeUndefined();
    const issue = created.json.data.createIssue;
    expect(issue.title).toBe("[vitest] graphql issue");
    expect(issue.priority).toBe("high");

    const updated = await gql(
      `mutation { updateIssue(id: "${issue.id}", input: { title: "[vitest] graphql renamed", severity: "blocker" }) { title severity } }`,
      writeTok,
    );
    expect(updated.json.data.updateIssue.title).toBe("[vitest] graphql renamed");
    expect(updated.json.data.updateIssue.severity).toBe("blocker");

    // a transition must go through the real action, recording activity
    const statuses = await gql(`{ projects { id statuses { id category } } }`, writeTok);
    const proj = statuses.json.data.projects.find((p: any) => p.id === projectId);
    const done = proj.statuses.find((s: any) => s.category === "done") ?? proj.statuses[0];
    const moved = await gql(
      `mutation { changeStatus(id: "${issue.id}", statusId: "${done.id}") { status { name category } } }`,
      writeTok,
    );
    expect(moved.json.data.changeStatus.status.category).toBe(done.category);
    const activity = await prisma.activity.findFirst({
      where: { issueId: issue.id, verb: "status_changed" },
    });
    expect(activity).not.toBeNull();

    const commented = await gql(
      `mutation { addComment(issueId: "${issue.id}", body: "[vitest] via graphql") { id bodyMd } }`,
      writeTok,
    );
    expect(commented.json.data.addComment.bodyMd).toBe("[vitest] via graphql");

    const deleted = await gql(`mutation { deleteIssue(id: "${issue.id}") }`, writeTok);
    expect(deleted.json.data.deleteIssue).toBe(true);
    const gone = await gql(`{ issue(id: "${issue.id}") { id } }`, readTok);
    expect(gone.json.data.issue).toBeNull();
  });

  it("reports validation failures without leaking internals", async () => {
    if (!up) return;
    const res = await gql(
      `mutation { createIssue(input: { projectId: "${projectId}", title: "" }) { id } }`,
      writeTok,
    );
    const msg = JSON.stringify(res.json.errors ?? []);
    expect(res.json.errors?.length).toBeGreaterThan(0);
    for (const leak of ["prisma", "invalid `", "node_modules", "\\projects\\"]) {
      expect(msg.toLowerCase()).not.toContain(leak);
    }
  });
});

describe("cross-tenant isolation", () => {
  it("hides another organization's issues", async () => {
    if (!up) return;
    const org = await prisma.organization.create({
      data: { name: "[vitest] GQL", slug: "vitest-gql-" + Date.now(), logoColor: "#000" },
    });
    const user = await prisma.user.create({
      data: { name: "[vitest] gql", email: `vitest-gql-${Date.now()}@x.test`, orgId: org.id },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role: "owner" } });
    const raw = "bt_" + Date.now() + Math.random().toString(36).slice(2);
    const { createHash } = await import("node:crypto");
    await prisma.apiToken.create({
      data: {
        name: "vitest",
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        prefix: raw.slice(0, 9),
        scopes: "read,write",
        userId: user.id,
        orgId: org.id,
      },
    });

    // a valid id from the other tenant resolves to null, not an error that
    // would confirm it exists
    const peek = await gql(`{ issue(id: "${sampleIssueId}") { id title } }`, raw);
    expect(peek.json.data.issue).toBeNull();

    const list = await gql("{ issues { nodes { id } total } }", raw);
    expect(list.json.data.issues.total).toBe(0);

    const write = await gql(
      `mutation { updateIssue(id: "${sampleIssueId}", input: { title: "[vitest] pwned" }) { id } }`,
      raw,
    );
    expect(write.json.errors?.length).toBeGreaterThan(0);

    const victim = await gql(`{ issue(id: "${sampleIssueId}") { title } }`, readTok);
    expect(victim.json.data.issue.title).not.toBe("[vitest] pwned");

    await prisma.apiToken.deleteMany({ where: { orgId: org.id } });
    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});

describe("request limits", () => {
  it("rejects an oversized or deeply nested query", async () => {
    if (!up) return;
    const huge = "{ me { id " + "\n".repeat(11_000) + " } }";
    expect((await gql(huge, readTok)).status).toBe(413);

    const deep = "{" + " a {".repeat(20) + " b " + "}".repeat(20) + "}";
    expect((await gql(deep, readTok)).status).toBe(400);
  });

  it("rejects a missing or non-JSON body", async () => {
    if (!up) return;
    expect((await gql("", readTok)).status).toBe(400);
    const res = await fetch(`${BASE}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${readTok}` },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});
