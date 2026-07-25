import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma, sessionFor, getPage, sha256, serverIsUp, actingAs } from "../helpers";
import { peekInvitation } from "@/lib/invite-queries";
import { acceptInvitationAction } from "@/lib/invite-actions";

let up = false;
let orgId = "";
let ownerId = "";

beforeAll(async () => {
  up = await serverIsUp();
  const org = await prisma.organization.findFirst({ where: { slug: "acme" } });
  const owner = await prisma.user.findUnique({ where: { email: "you@shani.dev" } });
  orgId = org!.id;
  ownerId = owner!.id;
});

afterAll(async () => {
  await prisma.invitation.deleteMany({ where: { email: { contains: "vitest" } } });
});

async function makeInvite(email: string, opts: Partial<{ expiresAt: Date; revokedAt: Date; role: string }> = {}) {
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      orgId,
      email,
      role: opts.role ?? "member",
      tokenHash: sha256(token),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
      revokedAt: opts.revokedAt ?? null,
      invitedById: ownerId,
    },
  });
  return token;
}

describe("invitation tokens", () => {
  it("stores only the hash", async () => {
    const token = await makeInvite("vitest-hash@acme.dev");
    const row = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("resolves a live invite and hides the org id", async () => {
    const token = await makeInvite("vitest-live@acme.dev");
    const peeked = await peekInvitation(token);
    expect(peeked?.email).toBe("vitest-live@acme.dev");
    expect(peeked).not.toHaveProperty("orgId");
  });

  it("refuses unknown, expired and revoked invites", async () => {
    expect(await peekInvitation("nonsense")).toBeNull();
    expect(await peekInvitation("")).toBeNull();
    expect(await peekInvitation(await makeInvite("vitest-exp@acme.dev", { expiresAt: new Date(Date.now() - 1000) }))).toBeNull();
    expect(await peekInvitation(await makeInvite("vitest-rev@acme.dev", { revokedAt: new Date() }))).toBeNull();
  });
});

describe("invite acceptance page", () => {
  it("renders for a valid token without any session", async () => {
    if (!up) return;
    const token = await makeInvite("vitest-page@acme.dev");
    const res = await getPage(`/invite/${token}?name=Vitest%20User`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Acme Software");
    expect(res.body).toContain("vitest-page@acme.dev");
  });

  it("shows an error for a bad token and leaks no org name", async () => {
    if (!up) return;
    const res = await getPage("/invite/not-a-real-token");
    expect(res.body).toMatch(/isn.t valid/i);
    expect(res.body).not.toContain("Acme Software");
  });
});

describe("invite cannot take over an existing account", () => {
  // Regression, twice over: an invite once minted a session for an existing
  // user. The first fix only covered accounts WITH a password — but the auth
  // migration leaves every pre-existing user password-less, so the guard has
  // to key off row existence.
  async function attemptTakeover(victimEmail: string) {
    const token = await makeInvite(victimEmail, { role: "owner" });
    const fd = new FormData();
    fd.set("token", token);
    fd.set("password", "attacker-chosen-password");
    fd.set("name", "Not The Owner");

    let refused = false;
    try {
      const res = await acceptInvitationAction({}, fd as unknown as FormData);
      refused = Boolean(res?.error);
    } catch {
      refused = true; // no request context == unauthenticated
    }
    return { refused, token };
  }

  it("refuses for an account that has a password", async () => {
    const before = await prisma.user.findUnique({ where: { email: "you@shani.dev" } });
    const { refused, token } = await attemptTakeover("you@shani.dev");

    expect(refused).toBe(true);
    const after = await prisma.user.findUnique({ where: { email: "you@shani.dev" } });
    expect(after!.passwordHash).toBe(before!.passwordHash);
    expect(after!.name).toBe(before!.name);
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    expect(inv!.acceptedAt).toBeNull();
  });

  it("refuses when the attacker is signed in as a DIFFERENT user", async () => {
    // The strongest form: Mallory holds a valid session of her own and
    // redeems an invite minted for the owner's address.
    const before = await prisma.user.findUnique({ where: { email: "you@shani.dev" } });
    const token = await makeInvite("you@shani.dev", { role: "owner" });

    const fd = new FormData();
    fd.set("token", token);
    fd.set("password", "attacker-chosen-password");
    fd.set("name", "Mallory");

    const res = await actingAs("maya@acme.dev", () =>
      acceptInvitationAction({}, fd as unknown as FormData),
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.user.findUnique({ where: { email: "you@shani.dev" } });
    expect(after!.passwordHash).toBe(before!.passwordHash);
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    expect(inv!.acceptedAt).toBeNull();
  });

  it("ALLOWS the rightful owner to accept while signed in as themselves", async () => {
    // The guard must not break the legitimate flow: an existing user joining a
    // second workspace signs in first, then accepts.
    const email = `vitest-second-org-${Date.now()}@acme.dev`;
    const user = await prisma.user.create({
      data: { name: "Second Org User", email, passwordHash: "scrypt$32768$8$1$" + "a".repeat(32) + "$" + "b".repeat(128) },
    });
    const token = await makeInvite(email, { role: "member" });

    const fd = new FormData();
    fd.set("token", token);
    fd.set("password", "unused-for-existing-accounts");
    fd.set("name", "Second Org User");

    const res = await actingAs(email, () => acceptInvitationAction({}, fd as unknown as FormData));

    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    const membership = await prisma.membership.findFirst({ where: { orgId, userId: user.id } });
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe("member");

    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses for a password-less account (post-migration state)", async () => {
    const email = `vitest-legacy-${Date.now()}@acme.dev`;
    const legacy = await prisma.user.create({
      data: { name: "Legacy", email, orgId, passwordHash: null },
    });

    const { refused, token } = await attemptTakeover(email);
    expect(refused).toBe(true);

    const after = await prisma.user.findUnique({ where: { id: legacy.id } });
    expect(after!.passwordHash).toBeNull();
    expect(after!.name).toBe("Legacy");
    expect(await prisma.session.count({ where: { userId: legacy.id } })).toBe(0);
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    expect(inv!.acceptedAt).toBeNull();

    await prisma.user.delete({ where: { id: legacy.id } });
  });
});

describe("settings is gated", () => {
  it("hides the admin surface from a guest", async () => {
    if (!up) return;
    const { token } = await sessionFor("sana@acme.dev"); // guest
    const res = await getPage("/settings", token);
    expect(res.body).toMatch(/don.t have access to settings/i);
    expect(res.body).not.toContain("maya@acme.dev"); // no member roster
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  });

  it("shows it to an owner", async () => {
    if (!up) return;
    const { token } = await sessionFor("you@shani.dev");
    const res = await getPage("/settings", token);
    expect(res.status).toBe(200);
    expect(res.body).toContain("maya@acme.dev");
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  });
});

describe("private comments", () => {
  it("are withheld from guest accounts", async () => {
    if (!up) return;
    const issue = await prisma.issue.findFirst({ where: { deletedAt: null }, select: { id: true } });
    const staff = await prisma.user.findUnique({ where: { email: "maya@acme.dev" } });
    const secret = `[vitest] INTERNAL ${randomBytes(4).toString("hex")}`;
    await prisma.comment.create({
      data: { issueId: issue!.id, authorId: staff!.id, bodyMd: secret, isPrivate: true },
    });

    const guest = await sessionFor("sana@acme.dev");
    const staffSession = await sessionFor("you@shani.dev");

    const guestView = await getPage(`/issue/${issue!.id}`, guest.token);
    const staffView = await getPage(`/issue/${issue!.id}`, staffSession.token);

    expect(guestView.body).not.toContain(secret);
    expect(staffView.body).toContain(secret);

    await prisma.comment.deleteMany({ where: { bodyMd: secret } });
    await prisma.session.deleteMany({
      where: { tokenHash: { in: [sha256(guest.token), sha256(staffSession.token)] } },
    });
  });
});
