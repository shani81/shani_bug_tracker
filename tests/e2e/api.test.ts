import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, tokenFor, api, sha256, serverIsUp, BASE, cleanupTestArtifacts } from "../helpers";

let up = false;
let readTok = "";
let writeTok = "";
let projectId = "";
let statusIdDone = "";
let sampleIssueId = "";

beforeAll(async () => {
  up = await serverIsUp();
  if (!up) return;
  readTok = (await tokenFor("you@shani.dev", "read")).raw;
  writeTok = (await tokenFor("you@shani.dev", "read,write")).raw;

  const projects = await api("/api/v1/projects", readTok);
  projectId = projects.json.data[0].id;
  statusIdDone =
    projects.json.data[0].statuses.find((s: any) => s.category === "done")?.id ??
    projects.json.data[0].statuses[0].id;

  const issues = await api("/api/v1/issues?limit=1", readTok);
  sampleIssueId = issues.json.data[0].id;
});

afterAll(async () => {
  await cleanupTestArtifacts();
});

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ projectId, title: "[vitest] api issue", type: "bug", ...extra });

describe("token authentication", () => {
  it("rejects missing, malformed and unknown tokens", async () => {
    if (!up) return;
    for (const t of [undefined, "not-prefixed", "bt_made-up-value"]) {
      const res = await api("/api/v1/issues", t);
      expect(res.status, String(t)).toBe(401);
      expect(res.json?.error?.code).toBe("UNAUTHENTICATED");
    }
  });

  it("reports identity and scopes on /me", async () => {
    if (!up) return;
    const res = await api("/api/v1/me", readTok);
    expect(res.status).toBe(200);
    expect(res.json.data.email).toBe("you@shani.dev");
    expect(res.json.data.authenticatedVia).toBe("token");
    expect(res.json.data.scopes).toEqual(["read"]);
  });

  it("dies on revocation, expiry and membership deactivation", async () => {
    if (!up) return;

    const revoked = await tokenFor("maya@acme.dev", "read");
    expect((await api("/api/v1/me", revoked.raw)).status).toBe(200);
    await prisma.apiToken.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    expect((await api("/api/v1/me", revoked.raw)).status).toBe(401);

    const expired = await tokenFor("diego@acme.dev", "read");
    await prisma.apiToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await api("/api/v1/me", expired.raw)).status).toBe(401);

    const suspended = await tokenFor("tom@acme.dev", "read");
    await prisma.membership.updateMany({ where: { userId: suspended.user.id }, data: { isActive: false } });
    expect((await api("/api/v1/me", suspended.raw)).status).toBe(401);
    await prisma.membership.updateMany({ where: { userId: suspended.user.id }, data: { isActive: true } });
  });

  it("stores only the hash of a token", async () => {
    const t = await tokenFor("priya@acme.dev", "read");
    const row = await prisma.apiToken.findUnique({ where: { id: t.id } });
    expect(JSON.stringify(row)).not.toContain(t.raw);
    expect(row!.tokenHash).toBe(sha256(t.raw));
  });
});

describe("scope enforcement", () => {
  // The headline guarantee: a read token cannot mutate, whatever its owner's role.
  it("blocks every write verb for a read-only token", async () => {
    if (!up) return;
    const attempts = [
      ["POST", "/api/v1/issues", body()],
      ["PATCH", `/api/v1/issues/${sampleIssueId}`, JSON.stringify({ title: "[vitest] hijacked" })],
      ["DELETE", `/api/v1/issues/${sampleIssueId}`, undefined],
      ["POST", `/api/v1/issues/${sampleIssueId}/comments`, JSON.stringify({ body: "nope" })],
    ] as const;

    for (const [method, path, payload] of attempts) {
      const res = await api(path, readTok, { method, ...(payload ? { body: payload } : {}) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("leaves data untouched after a denied write", async () => {
    if (!up) return;
    const after = await api(`/api/v1/issues/${sampleIssueId}`, readTok);
    expect(after.json.data.title).not.toBe("[vitest] hijacked");
  });

  it("allows writes for a write-scoped token", async () => {
    if (!up) return;
    const created = await api("/api/v1/issues", writeTok, { method: "POST", body: body() });
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    expect(created.json.data.key).toMatch(/-\d{6}$/);

    const patched = await api(`/api/v1/issues/${id}`, writeTok, {
      method: "PATCH",
      body: JSON.stringify({ priority: "high" }),
    });
    expect(patched.status).toBe(200);
    expect(patched.json.data.priority).toBe("high");

    const commented = await api(`/api/v1/issues/${id}/comments`, writeTok, {
      method: "POST",
      body: JSON.stringify({ body: "[vitest] via API" }),
    });
    expect(commented.status).toBe(201);

    // a status change must route through the transition logic, not a blind write
    const moved = await api(`/api/v1/issues/${id}`, writeTok, {
      method: "PATCH",
      body: JSON.stringify({ statusId: statusIdDone }),
    });
    expect(moved.status).toBe(200);
    const activity = await prisma.activity.findFirst({ where: { issueId: id, verb: "status_changed" } });
    expect(activity).not.toBeNull();

    expect((await api(`/api/v1/issues/${id}`, writeTok, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/v1/issues/${id}`, readTok)).status).toBe(404);
  });
});

describe("RBAC still applies through the API", () => {
  it("honours the project-viewer clamp", async () => {
    if (!up) return;
    // Sana is a guest AND a project viewer everywhere.
    const guest = await tokenFor("sana@acme.dev", "read,write");
    const res = await api("/api/v1/issues", guest.raw, { method: "POST", body: body() });
    expect(res.status).toBe(403);
  });

  it("lets an unclamped member create", async () => {
    if (!up) return;
    const dev = await tokenFor("maya@acme.dev", "read,write");
    const res = await api("/api/v1/issues", dev.raw, { method: "POST", body: body() });
    expect(res.status).toBe(201);
  });
});

describe("cross-tenant isolation", () => {
  it("hides another org's records behind 404 and blocks writes to them", async () => {
    if (!up) return;
    const org = await prisma.organization.create({
      data: { name: "[vitest] Rival", slug: "vitest-rival-" + Date.now(), logoColor: "#000" },
    });
    const user = await prisma.user.create({
      data: { name: "[vitest] Rival", email: `vitest-rival-${Date.now()}@rival.test`, orgId: org.id },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role: "owner" } });
    const raw = "bt_" + Math.random().toString(36).slice(2) + Date.now();
    await prisma.apiToken.create({
      data: {
        name: "vitest", tokenHash: sha256(raw), prefix: raw.slice(0, 9),
        scopes: "read,write", userId: user.id, orgId: org.id,
      },
    });

    expect((await api(`/api/v1/issues/${sampleIssueId}`, raw)).status).toBe(404);
    expect((await api("/api/v1/issues", raw)).json.data).toHaveLength(0);
    expect(
      (await api(`/api/v1/issues/${sampleIssueId}`, raw, {
        method: "PATCH", body: JSON.stringify({ title: "[vitest] pwned" }),
      })).status,
    ).toBe(404);
    // creating against another org's project must also fail
    expect((await api("/api/v1/issues", raw, { method: "POST", body: body() })).status).toBe(404);

    const victim = await api(`/api/v1/issues/${sampleIssueId}`, readTok);
    expect(victim.json.data.title).not.toBe("[vitest] pwned");

    await prisma.apiToken.deleteMany({ where: { orgId: org.id } });
    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});

describe("a token is not a session", () => {
  // Regression: Bearer auth was global, so a write token could drive any
  // server action — including team administration — and render app pages.
  it("cannot render authenticated pages", async () => {
    if (!up) return;
    for (const path of ["/", "/settings", "/bugs"]) {
      const res = await fetch(BASE + path, {
        headers: { Authorization: `Bearer ${writeTok}` },
        redirect: "manual",
      });
      expect(res.status, path).toBe(307);
    }
  });

  it("cannot drive a server action", async () => {
    if (!up) return;
    for (const route of ["/settings", "/notifications", "/invite/x"]) {
      const res = await fetch(BASE + route, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${writeTok}`,
          "Next-Action": "0".repeat(40),
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body: "[]",
        redirect: "manual",
      });
      const text = await res.text();
      expect(/Workspace members|maya@acme\.dev|Acme Software/.test(text), route).toBe(false);
    }
  });
});

describe("request handling", () => {
  it("rejects malformed bodies", async () => {
    if (!up) return;
    for (const payload of ["{not json", "[1,2,3]", '"a string"']) {
      const res = await api("/api/v1/issues", writeTok, { method: "POST", body: payload });
      expect(res.status, payload).toBeGreaterThanOrEqual(400);
      expect(res.status, payload).toBeLessThan(500);
    }
  });

  it("rejects an empty patch rather than silently succeeding", async () => {
    if (!up) return;
    const res = await api(`/api/v1/issues/${sampleIssueId}`, writeTok, { method: "PATCH", body: "{}" });
    expect(res.status).toBe(400);
  });

  it("clamps pagination and reports a real total", async () => {
    if (!up) return;
    const res = await api("/api/v1/issues?limit=99999", readTok);
    expect(res.json.pagination.limit).toBe(100);
    expect(res.json.pagination.total).toBeGreaterThan(0);
    expect(typeof res.json.pagination.hasMore).toBe("boolean");
  });

  it("paginates for real (offset returns different rows)", async () => {
    if (!up) return;
    const p1 = await api("/api/v1/issues?limit=3&offset=0", readTok);
    const p2 = await api("/api/v1/issues?limit=3&offset=3", readTok);
    const ids1 = p1.json.data.map((i: any) => i.id);
    const ids2 = p2.json.data.map((i: any) => i.id);
    expect(ids1).not.toEqual(ids2);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("does not leak internals in error messages", async () => {
    if (!up) return;
    const res = await api("/api/v1/issues", writeTok, {
      method: "POST",
      body: JSON.stringify({ projectId, title: "" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const msg = JSON.stringify(res.json);
    for (const leak of ["prisma", "Invalid `", "\\Projects\\", "node_modules"]) {
      expect(msg.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });
});
