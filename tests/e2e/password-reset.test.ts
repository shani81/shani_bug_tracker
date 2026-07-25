import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, actingAs, sessionFor, getPage, sha256, serverIsUp, tokenFor, api } from "../helpers";
import { issuePasswordReset, changeMemberRole } from "@/lib/team-actions";
import { completePasswordResetAction } from "@/lib/reset-actions";
import { peekPasswordReset } from "@/lib/reset-queries";
import { verifyPassword } from "@/lib/auth";

let up = false;
let victimId = "";
let originalHash = "";

beforeAll(async () => {
  up = await serverIsUp();
  const maya = await prisma.user.findUnique({ where: { email: "maya@acme.dev" } });
  victimId = maya!.id;
  originalHash = maya!.passwordHash!;
});

afterAll(async () => {
  // restore the seeded password so other suites are unaffected
  await prisma.user.update({ where: { id: victimId }, data: { passwordHash: originalHash } });
  await prisma.passwordReset.deleteMany({});
});

function form(token: string, password: string) {
  const fd = new FormData();
  fd.set("token", token);
  fd.set("password", password);
  return fd as unknown as FormData;
}

describe("issuing a reset", () => {
  it("requires member:manage", async () => {
    await expect(actingAs("maya@acme.dev", () => issuePasswordReset(victimId))).rejects.toThrow();
    await expect(actingAs("sana@acme.dev", () => issuePasswordReset(victimId))).rejects.toThrow();
  });

  it("stores only the hash of the token", async () => {
    const res = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const token = res.url.split("/reset/")[1];
    const row = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("refuses a member from another organization", async () => {
    const org = await prisma.organization.create({
      data: { name: "[vitest] PR", slug: "vitest-pr-" + Date.now(), logoColor: "#000" },
    });
    const outsider = await prisma.user.create({
      data: { name: "[vitest] Outsider", email: `vitest-pr-${Date.now()}@x.test`, orgId: org.id },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: outsider.id, role: "member" } });

    const res = await actingAs("you@shani.dev", () => issuePasswordReset(outsider.id));
    expect(res.ok).toBe(false);

    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.user.delete({ where: { id: outsider.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  // The important one: a reset must not be a route to seizing a higher account.
  it("does not let an admin reset an owner's password", async () => {
    const owner = await prisma.user.findUnique({ where: { email: "you@shani.dev" } });
    const res = await actingAs("leo@acme.dev", () => issuePasswordReset(owner!.id)); // leo is admin
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only an owner/i);
  });

  // CRITICAL regression: User.passwordHash is a GLOBAL credential while
  // authorization is per-org. Without a cross-org check, an admin of a
  // low-value workspace could reset the password of someone who owns a
  // different workspace and then sign in there.
  it("refuses when the target holds authority in another organization", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "[vitest] Valuable", slug: "vitest-val-" + Date.now(), logoColor: "#000" },
    });
    // maya is a member of Acme AND an owner of the other org
    await prisma.membership.create({
      data: { orgId: otherOrg.id, userId: victimId, role: "owner" },
    });

    const res = await actingAs("leo@acme.dev", () => issuePasswordReset(victimId)); // Acme admin
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/other workspaces/i);

    await prisma.membership.deleteMany({ where: { orgId: otherOrg.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  it("refuses for a member who was deactivated in this org", async () => {
    await prisma.membership.updateMany({ where: { userId: victimId }, data: { isActive: false } });
    const res = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    expect(res.ok).toBe(false);
    await prisma.membership.updateMany({ where: { userId: victimId }, data: { isActive: true } });
  });

  // TOCTOU: the window between issuing and consuming is 2 hours.
  it("re-authorizes at consumption, so a promotion voids an issued link", async () => {
    const issued = await actingAs("leo@acme.dev", () => issuePasswordReset(victimId)); // admin -> member: ok
    if (!issued.ok) throw new Error("setup failed: " + issued.error);
    const token = issued.url.split("/reset/")[1];

    // the target is promoted to owner before the link is used
    await prisma.membership.updateMany({
      where: { userId: victimId, orgId: { not: undefined } },
      data: { role: "owner" },
    });

    const before = await prisma.user.findUnique({ where: { id: victimId } });
    const res = await completePasswordResetAction({}, form(token, "seized-by-admin"));
    expect(res.error).toBeTruthy();

    const after = await prisma.user.findUnique({ where: { id: victimId } });
    expect(after!.passwordHash).toBe(before!.passwordHash);

    await prisma.membership.updateMany({ where: { userId: victimId }, data: { role: "member" } });
  });

  it("voids an outstanding reset when the member's role changes", async () => {
    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    const token = issued.url.split("/reset/")[1];
    expect(await peekPasswordReset(token)).not.toBeNull();

    await actingAs("you@shani.dev", () => changeMemberRole(victimId, "guest"));
    expect(await peekPasswordReset(token)).toBeNull();

    await actingAs("you@shani.dev", () => changeMemberRole(victimId, "member"));
  });

  it("supersedes an earlier outstanding reset", async () => {
    const first = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    const second = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!first.ok || !second.ok) throw new Error("setup failed");

    const t1 = first.url.split("/reset/")[1];
    const t2 = second.url.split("/reset/")[1];
    expect(await peekPasswordReset(t1)).toBeNull(); // invalidated
    expect(await peekPasswordReset(t2)).not.toBeNull();
  });
});

describe("consuming a reset", () => {
  it("changes the password, and only once", async () => {
    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    const token = issued.url.split("/reset/")[1];

    const res = await completePasswordResetAction({}, form(token, "brand-new-password"));
    expect(res.ok).toBe(true);

    const after = await prisma.user.findUnique({ where: { id: victimId } });
    expect(await verifyPassword("brand-new-password", after!.passwordHash)).toBe(true);
    expect(await verifyPassword("demo1234", after!.passwordHash)).toBe(false);

    // single use
    const again = await completePasswordResetAction({}, form(token, "another-password"));
    expect(again.error).toBeTruthy();
    const unchanged = await prisma.user.findUnique({ where: { id: victimId } });
    expect(unchanged!.passwordHash).toBe(after!.passwordHash);
  });

  it("rejects unknown, expired and already-used tokens", async () => {
    expect((await completePasswordResetAction({}, form("nonsense", "some-password"))).error).toBeTruthy();

    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    const token = issued.url.split("/reset/")[1];
    await prisma.passwordReset.updateMany({
      where: { tokenHash: sha256(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await completePasswordResetAction({}, form(token, "some-password"))).error).toBeTruthy();
    expect(await peekPasswordReset(token)).toBeNull();
  });

  it("enforces a minimum password length", async () => {
    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    const token = issued.url.split("/reset/")[1];

    const res = await completePasswordResetAction({}, form(token, "short"));
    expect(res.error).toBeTruthy();
    // a rejected attempt must not consume the token
    expect(await peekPasswordReset(token)).not.toBeNull();
  });

  it("kills existing sessions and API tokens", async () => {
    // give the victim a live session and a live API token
    const { token: cookie } = await sessionFor("maya@acme.dev");
    const apiTok = await tokenFor("maya@acme.dev", "read,write");
    if (up) expect((await api("/api/v1/me", apiTok.raw)).status).toBe(200);

    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    await completePasswordResetAction({}, form(issued.url.split("/reset/")[1], "post-reset-password"));

    expect(await prisma.session.count({ where: { userId: victimId } })).toBe(0);
    const tokenRow = await prisma.apiToken.findUnique({ where: { id: apiTok.id } });
    expect(tokenRow!.revokedAt).not.toBeNull();

    if (up) {
      expect((await getPage("/", cookie)).status).toBe(307);
      expect((await api("/api/v1/me", apiTok.raw)).status).toBe(401);
    }
  });

  it("does not sign the visitor in", async () => {
    // Holding the link proves possession, not identity — no auto-login.
    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    await completePasswordResetAction({}, form(issued.url.split("/reset/")[1], "yet-another-password"));
    expect(await prisma.session.count({ where: { userId: victimId } })).toBe(0);
  });
});

describe("the reset page", () => {
  it("renders for a valid token without a session", async () => {
    if (!up) return;
    const issued = await actingAs("you@shani.dev", () => issuePasswordReset(victimId));
    if (!issued.ok) throw new Error("setup failed");
    const token = issued.url.split("/reset/")[1];

    const res = await getPage(`/reset/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("maya@acme.dev");
  });

  it("shows an error for a bad token and leaks no account details", async () => {
    if (!up) return;
    const res = await getPage("/reset/not-a-real-token");
    expect(res.body).toMatch(/isn.t valid/i);
    expect(res.body).not.toContain("maya@acme.dev");
  });
});
