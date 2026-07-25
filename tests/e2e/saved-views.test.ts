import { describe, it, expect, afterAll } from "vitest";
import { prisma, actingAs } from "../helpers";
import { saveView, deleteView, setViewShared } from "@/lib/view-actions";
import { getSavedViews } from "@/lib/queries";

afterAll(async () => {
  await prisma.savedSearch.deleteMany({ where: { name: { contains: "[vitest]" } } });
});

describe("saving a view", () => {
  it("persists the filter and returns it to its author", async () => {
    const res = await actingAs("you@shani.dev", () =>
      saveView({
        name: "[vitest] critical open",
        group: "bug",
        filter: { priority: "critical", statusId: "started", view: "board" },
      }),
    );
    expect(res.ok).toBe(true);

    const views = await actingAs("you@shani.dev", () => getSavedViews("bug"));
    const mine = views.find((v) => v.name === "[vitest] critical open");
    expect(mine).toBeDefined();
    expect(mine!.filter.priority).toBe("critical");
    expect(mine!.filter.view).toBe("board");
    expect(mine!.isMine).toBe(true);
    expect(mine!.isShared).toBe(false);
  });

  it("rejects an empty name and an unknown group", async () => {
    const noName = await actingAs("you@shani.dev", () =>
      saveView({ name: "   ", group: "bug", filter: {} }),
    );
    expect(noName.ok).toBe(false);

    const badGroup = await actingAs("you@shani.dev", () =>
      saveView({ name: "[vitest] x", group: "not-a-group", filter: {} }),
    );
    expect(badGroup.ok).toBe(false);
  });

  it("discards filter keys that are not part of the schema", async () => {
    await actingAs("you@shani.dev", () =>
      saveView({
        name: "[vitest] extra keys",
        group: "bug",
        // deliberately smuggling something the filter does not support
        filter: { priority: "high", orgId: "other-org", isAdmin: "true" } as never,
      }),
    );
    const views = await actingAs("you@shani.dev", () => getSavedViews("bug"));
    const v = views.find((x) => x.name === "[vitest] extra keys")!;
    expect(v.filter.priority).toBe("high");
    expect(v.filter).not.toHaveProperty("orgId");
    expect(v.filter).not.toHaveProperty("isAdmin");
  });

  it("keeps views separated by module", async () => {
    await actingAs("you@shani.dev", () =>
      saveView({ name: "[vitest] feature only", group: "feature", filter: {} }),
    );
    const bugs = await actingAs("you@shani.dev", () => getSavedViews("bug"));
    const features = await actingAs("you@shani.dev", () => getSavedViews("feature"));
    expect(bugs.some((v) => v.name === "[vitest] feature only")).toBe(false);
    expect(features.some((v) => v.name === "[vitest] feature only")).toBe(true);
  });
});

describe("visibility", () => {
  it("keeps a private view private and reveals a shared one", async () => {
    const priv = await actingAs("you@shani.dev", () =>
      saveView({ name: "[vitest] private", group: "bug", filter: { priority: "low" } }),
    );
    await actingAs("you@shani.dev", () =>
      saveView({ name: "[vitest] shared", group: "bug", filter: { priority: "high" }, isShared: true }),
    );

    const otherUserSees = await actingAs("maya@acme.dev", () => getSavedViews("bug"));
    expect(otherUserSees.some((v) => v.name === "[vitest] private")).toBe(false);

    const shared = otherUserSees.find((v) => v.name === "[vitest] shared");
    expect(shared).toBeDefined();
    expect(shared!.isMine).toBe(false);
    expect(shared!.authorName).toBe("Shani Jee");

    expect(priv.ok).toBe(true);
  });

  it("does not leak across organizations", async () => {
    const org = await prisma.organization.create({
      data: { name: "[vitest] Views", slug: "vitest-views-" + Date.now(), logoColor: "#000" },
    });
    const outsider = await prisma.user.create({
      data: { name: "[vitest] Outsider", email: `vitest-views-${Date.now()}@x.test`, orgId: org.id },
    });
    await prisma.membership.create({ data: { orgId: org.id, userId: outsider.id, role: "owner" } });

    // even a SHARED view belongs to one tenant
    const seen = await actingAs(outsider.email, () => getSavedViews("bug"));
    expect(seen.some((v) => v.name.startsWith("[vitest]"))).toBe(false);

    await prisma.savedSearch.deleteMany({ where: { orgId: org.id } });
    await prisma.session.deleteMany({ where: { userId: outsider.id } });
    await prisma.membership.deleteMany({ where: { orgId: org.id } });
    await prisma.user.delete({ where: { id: outsider.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it("lets only the author change sharing", async () => {
    const created = await actingAs("maya@acme.dev", () =>
      saveView({ name: "[vitest] mayas", group: "bug", filter: {} }),
    );
    if (!created.ok) throw new Error("setup failed");

    // someone else cannot flip it, even an owner
    await expect(
      actingAs("you@shani.dev", () => setViewShared(created.id, true)),
    ).rejects.toThrow();

    const still = await prisma.savedSearch.findUnique({ where: { id: created.id } });
    expect(still!.isShared).toBe(false);

    // the author can
    await actingAs("maya@acme.dev", () => setViewShared(created.id, true));
    const now = await prisma.savedSearch.findUnique({ where: { id: created.id } });
    expect(now!.isShared).toBe(true);
  });
});

describe("deleting", () => {
  it("lets the author delete their own view", async () => {
    const created = await actingAs("maya@acme.dev", () =>
      saveView({ name: "[vitest] to delete", group: "bug", filter: {} }),
    );
    if (!created.ok) throw new Error("setup failed");

    await actingAs("maya@acme.dev", () => deleteView(created.id));
    expect(await prisma.savedSearch.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("refuses for a non-author who is not an admin", async () => {
    const created = await actingAs("maya@acme.dev", () =>
      saveView({ name: "[vitest] protected", group: "bug", filter: {} }),
    );
    if (!created.ok) throw new Error("setup failed");

    await expect(actingAs("diego@acme.dev", () => deleteView(created.id))).rejects.toThrow();
    expect(await prisma.savedSearch.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it("allows an org admin to tidy up", async () => {
    const created = await actingAs("maya@acme.dev", () =>
      saveView({ name: "[vitest] admin cleanup", group: "bug", filter: {} }),
    );
    if (!created.ok) throw new Error("setup failed");

    await actingAs("you@shani.dev", () => deleteView(created.id)); // owner
    expect(await prisma.savedSearch.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("refuses a foreign id rather than deleting something else", async () => {
    await expect(actingAs("you@shani.dev", () => deleteView("does-not-exist"))).rejects.toThrow();
  });
});
