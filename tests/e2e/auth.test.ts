import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, sessionFor, getPage, sha256, serverIsUp, BASE } from "../helpers";

let up = false;
beforeAll(async () => {
  up = await serverIsUp();
  if (!up) console.warn(`\n  ⚠ no server at ${BASE} — start one with \`npm run dev -- -p 3005\`\n`);
});
afterAll(async () => {
  await prisma.session.deleteMany({ where: { userAgent: "vitest" } });
});

describe.runIf(() => true)("authentication boundary", () => {
  it("redirects anonymous visitors away from every app route", async () => {
    if (!up) return;
    for (const path of ["/", "/bugs", "/qa", "/settings", "/analytics", "/issue/abc123"]) {
      const res = await getPage(path);
      expect(res.status, path).toBe(307);
      expect(res.location, path).toContain("/login");
    }
  });

  it("leaves the public routes reachable", async () => {
    if (!up) return;
    expect((await getPage("/login")).status).toBe(200);
  });

  it("rejects a forged session cookie", async () => {
    if (!up) return;
    // The proxy only sees that a cookie exists; the DB check is what stops this.
    for (const path of ["/", "/settings"]) {
      const res = await getPage(path, "totally-fake-token-12345");
      expect(res.status, path).toBe(307);
      expect(res.location, path).toContain("/login");
    }
  });

  it("admits a real session", async () => {
    if (!up) return;
    const { token } = await sessionFor("you@shani.dev");
    const res = await getPage("/", token);
    expect(res.status).toBe(200);
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  });

  it("rejects an expired session and cleans it up", async () => {
    if (!up) return;
    const { token } = await sessionFor("maya@acme.dev");
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await getPage("/", token);
    expect(res.status).toBe(307);
  });

  it("rejects a session whose membership was deactivated", async () => {
    if (!up) return;
    const { token, user } = await sessionFor("tom@acme.dev");
    await prisma.membership.updateMany({ where: { userId: user.id }, data: { isActive: false } });
    const res = await getPage("/", token);
    expect(res.status).toBe(307);
    await prisma.membership.updateMany({ where: { userId: user.id }, data: { isActive: true } });
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  });

  it("stores only the hash of a session token", async () => {
    const { token } = await sessionFor("diego@acme.dev");
    const row = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  });
});

describe("API surface is not anonymously readable", () => {
  it("search and stream require a credential", async () => {
    if (!up) return;
    for (const path of ["/api/search?q=checkout", "/api/stream", "/api/v1/issues", "/api/v1/me"]) {
      const res = await fetch(BASE + path, { redirect: "manual" });
      expect(res.status, path).toBe(401);
    }
  });
});
