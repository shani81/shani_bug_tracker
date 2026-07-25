import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, actingAs } from "../helpers";
import {
  createStatus, deleteStatus, setDefaultStatus, moveStatus,
  createLabel, deleteLabel,
  createComponent, deleteComponent,
  createProjectRelease, setReleaseStatus,
  createProjectSprint, setSprintStatus,
} from "@/lib/project-actions";

let projectId = "";

beforeAll(async () => {
  const p = await prisma.project.findFirst({ where: { key: "WEB" } });
  projectId = p!.id;
});

afterAll(async () => {
  await prisma.workflowStatus.deleteMany({ where: { name: { contains: "[vitest]" } } });
  await prisma.label.deleteMany({ where: { name: { contains: "[vitest]" } } });
  await prisma.component.deleteMany({ where: { name: { contains: "[vitest]" } } });
  await prisma.release.deleteMany({ where: { version: { contains: "vitest" } } });
  await prisma.sprint.deleteMany({ where: { name: { contains: "[vitest]" } } });
});

describe("permissions", () => {
  it("requires project:manage — a plain member cannot configure a project", async () => {
    // maya is a "developer" on this project: contributor, not manager
    await expect(
      actingAs("maya@acme.dev", () =>
        createLabel({ projectId, name: "[vitest] nope", color: "#5b5bd6" }),
      ),
    ).rejects.toThrow();
    await expect(
      actingAs("sana@acme.dev", () =>
        createComponent({ projectId, name: "[vitest] nope" }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a project in another organization", async () => {
    const org = await prisma.organization.create({
      data: { name: "[vitest] Cfg", slug: "vitest-cfg-" + Date.now(), logoColor: "#000" },
    });
    const foreign = await prisma.project.create({
      data: { orgId: org.id, key: "CFG", name: "[vitest] Foreign", icon: "🔒", color: "#000" },
    });

    await expect(
      actingAs("you@shani.dev", () =>
        createLabel({ projectId: foreign.id, name: "[vitest] x", color: "#5b5bd6" }),
      ),
    ).rejects.toThrow();

    await prisma.project.delete({ where: { id: foreign.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});

describe("workflow statuses", () => {
  it("creates, reorders, sets a default and rejects duplicates", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createStatus({ projectId, name: "[vitest] Triage", category: "unstarted", color: "#8b5cf6" }),
    );
    expect(res.ok).toBe(true);

    const dupe = await actingAs("you@shani.dev", () =>
      createStatus({ projectId, name: "[vitest] Triage", category: "unstarted", color: "#8b5cf6" }),
    );
    expect(dupe.ok).toBe(false);

    const created = await prisma.workflowStatus.findFirst({
      where: { projectId, name: "[vitest] Triage" },
    });
    expect(created).not.toBeNull();

    // new statuses land at the end, so "up" must change the ordering
    const before = await prisma.workflowStatus.findMany({
      where: { projectId }, orderBy: { order: "asc" }, select: { id: true },
    });
    await actingAs("you@shani.dev", () => moveStatus(created!.id, "up"));
    const after = await prisma.workflowStatus.findMany({
      where: { projectId }, orderBy: { order: "asc" }, select: { id: true },
    });
    expect(after.map((s) => s.id)).not.toEqual(before.map((s) => s.id));

    await actingAs("you@shani.dev", () => setDefaultStatus(created!.id));
    const defaults = await prisma.workflowStatus.findMany({ where: { projectId, isDefault: true } });
    expect(defaults).toHaveLength(1); // exactly one, always
    expect(defaults[0].id).toBe(created!.id);
  });

  it("rejects an unknown category", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createStatus({ projectId, name: "[vitest] Bad", category: "not-a-category", color: "#000000" }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a non-hex colour", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createStatus({ projectId, name: "[vitest] Colour", category: "unstarted", color: "red" }),
    );
    expect(res.ok).toBe(false);
  });

  // Deleting a status issues point at would orphan them.
  it("reassigns issues before deleting a status in use", async () => {
    const created = await prisma.workflowStatus.findFirst({
      where: { projectId, name: "[vitest] Triage" },
    });
    const issue = await prisma.issue.findFirst({ where: { projectId, deletedAt: null } });
    await prisma.issue.update({ where: { id: issue!.id }, data: { statusId: created!.id } });

    const res = await actingAs("you@shani.dev", () => deleteStatus(created!.id));
    expect(res.ok).toBe(true);

    const moved = await prisma.issue.findUnique({ where: { id: issue!.id } });
    expect(moved!.statusId).not.toBe(created!.id);
    // and it still points at a status in the SAME project
    const target = await prisma.workflowStatus.findUnique({ where: { id: moved!.statusId } });
    expect(target!.projectId).toBe(projectId);
  });
});

describe("labels and components", () => {
  it("creates and deletes a label, detaching it from issues", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createLabel({ projectId, name: "[vitest] flaky", color: "#d97706" }),
    );
    expect(res.ok).toBe(true);

    const label = await prisma.label.findFirst({ where: { projectId, name: "[vitest] flaky" } });
    const issue = await prisma.issue.findFirst({ where: { projectId, deletedAt: null } });
    await prisma.issueLabel.create({ data: { issueId: issue!.id, labelId: label!.id } });

    await actingAs("you@shani.dev", () => deleteLabel(label!.id));
    expect(await prisma.label.findUnique({ where: { id: label!.id } })).toBeNull();
    // the issue survives; only the association goes
    expect(await prisma.issue.findUnique({ where: { id: issue!.id } })).not.toBeNull();
    expect(await prisma.issueLabel.count({ where: { labelId: label!.id } })).toBe(0);
  });

  it("detaches a component from issues rather than deleting them", async () => {
    await actingAs("you@shani.dev", () => createComponent({ projectId, name: "[vitest] Checkout" }));
    const comp = await prisma.component.findFirst({ where: { projectId, name: "[vitest] Checkout" } });

    const issue = await prisma.issue.findFirst({ where: { projectId, deletedAt: null } });
    await prisma.issue.update({ where: { id: issue!.id }, data: { componentId: comp!.id } });

    await actingAs("you@shani.dev", () => deleteComponent(comp!.id));
    const after = await prisma.issue.findUnique({ where: { id: issue!.id } });
    expect(after).not.toBeNull();
    expect(after!.componentId).toBeNull();
  });
});

describe("releases and sprints", () => {
  it("creates a release and rejects a duplicate version", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createProjectRelease({ projectId, version: "vitest-9.9.9", name: "Test release" }),
    );
    expect(res.ok).toBe(true);

    const dupe = await actingAs("you@shani.dev", () =>
      createProjectRelease({ projectId, version: "vitest-9.9.9" }),
    );
    expect(dupe.ok).toBe(false);
  });

  it("rejects an invalid release date", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createProjectRelease({ projectId, version: "vitest-bad-date", releaseDate: "not-a-date" }),
    );
    expect(res.ok).toBe(false);
  });

  it("stamps releasedAt when a release ships", async () => {
    const rel = await prisma.release.findFirst({ where: { version: "vitest-9.9.9" } });
    await actingAs("you@shani.dev", () => setReleaseStatus(rel!.id, "released"));
    const after = await prisma.release.findUnique({ where: { id: rel!.id } });
    expect(after!.status).toBe("released");
    expect(after!.releasedAt).not.toBeNull();
  });

  it("rejects a sprint that ends before it starts", async () => {
    const res = await actingAs("you@shani.dev", () =>
      createProjectSprint({
        projectId,
        name: "[vitest] backwards",
        startDate: "2026-03-10",
        endDate: "2026-03-01",
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("keeps at most one active sprint per project", async () => {
    await actingAs("you@shani.dev", () => createProjectSprint({ projectId, name: "[vitest] S1" }));
    await actingAs("you@shani.dev", () => createProjectSprint({ projectId, name: "[vitest] S2" }));
    const s1 = await prisma.sprint.findFirst({ where: { projectId, name: "[vitest] S1" } });
    const s2 = await prisma.sprint.findFirst({ where: { projectId, name: "[vitest] S2" } });

    await actingAs("you@shani.dev", () => setSprintStatus(s1!.id, "active"));
    await actingAs("you@shani.dev", () => setSprintStatus(s2!.id, "active"));

    const active = await prisma.sprint.findMany({ where: { projectId, status: "active" } });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(s2!.id);
  });
});
