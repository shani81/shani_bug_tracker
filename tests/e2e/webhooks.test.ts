import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma, actingAs } from "../helpers";
import { createWebhook, deleteWebhook, setWebhookEnabled, testWebhook } from "@/lib/webhook-actions";
import { dispatchWebhooks, verifySignature } from "@/lib/webhooks";
import { getSettings } from "@/lib/module-queries";

// A real receiver, so signing and delivery are exercised end to end rather
// than mocked.
type Received = { headers: Record<string, string>; body: string };
let server: Server;
let port = 0;
let received: Received[] = [];
let respondWith = 200;

let orgId = "";
let projectId = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers as Record<string, string>, body });
      res.writeHead(respondWith).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;

  const org = await prisma.organization.findFirst({ where: { slug: "acme" } });
  orgId = org!.id;
  const project = await prisma.project.findFirst({ where: { orgId } });
  projectId = project!.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.webhook.deleteMany({ where: { name: { contains: "[vitest]" } } });
});

// Every test starts from a clean slate: a hook left behind by an earlier test
// would fire during a later one and make "expected 0 deliveries" fail.
beforeEach(async () => {
  await prisma.webhook.deleteMany({ where: { name: { contains: "[vitest]" } } });
  received = [];
  respondWith = 200;
});

const url = () => `http://127.0.0.1:${port}/hook`;

async function makeHook(events: string[] = ["issue.created"], project?: string | null) {
  const res = await actingAs("you@shani.dev", () =>
    createWebhook({ name: "[vitest] receiver", url: url(), projectId: project ?? null, events }),
  );
  if (!res.ok) throw new Error("setup failed: " + res.error);
  return res;
}

describe("creating webhooks", () => {
  it("returns the signing secret exactly once", async () => {
    received = [];
    const res = await makeHook();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.secret.startsWith("whsec_")).toBe(true);

    // and never exposes it again through the settings payload
    const settings = await actingAs("you@shani.dev", () => getSettings());
    const listed = settings.webhooks.find((w) => w.id === res.id);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(res.secret);
  });

  it("rejects an unsafe URL", async () => {
    // NODE_ENV is not production in tests, so private targets are permitted;
    // schemes and credentials are refused regardless.
    for (const bad of ["file:///etc/passwd", "not-a-url", "https://user:pw@example.com/x"]) {
      const res = await actingAs("you@shani.dev", () =>
        createWebhook({ name: "[vitest] bad", url: bad, events: ["issue.created"] }),
      );
      expect(res.ok, bad).toBe(false);
    }
  });

  it("requires at least one event and a name", async () => {
    expect(
      (await actingAs("you@shani.dev", () => createWebhook({ name: "[vitest] x", url: url(), events: [] }))).ok,
    ).toBe(false);
    expect(
      (await actingAs("you@shani.dev", () => createWebhook({ name: "  ", url: url(), events: ["issue.created"] }))).ok,
    ).toBe(false);
  });

  it("refuses a project from another organization", async () => {
    const other = await prisma.organization.create({
      data: { name: "[vitest] WH", slug: "vitest-wh-" + Date.now(), logoColor: "#000" },
    });
    const foreign = await prisma.project.create({
      data: { orgId: other.id, key: "FGN", name: "[vitest] Foreign", icon: "🔒", color: "#000" },
    });

    const res = await actingAs("you@shani.dev", () =>
      createWebhook({ name: "[vitest] cross", url: url(), projectId: foreign.id, events: ["issue.created"] }),
    );
    expect(res.ok).toBe(false);

    await prisma.project.delete({ where: { id: foreign.id } });
    await prisma.organization.delete({ where: { id: other.id } });
  });

  it("is refused for non-admins", async () => {
    await expect(
      actingAs("maya@acme.dev", () =>
        createWebhook({ name: "[vitest] nope", url: url(), events: ["issue.created"] }),
      ),
    ).rejects.toThrow();
  });
});

describe("delivery", () => {
  it("signs the payload so a receiver can verify it", async () => {
    received = [];
    respondWith = 200;
    const hook = await makeHook(["issue.created"]);
    if (!hook.ok) return;

    await dispatchWebhooks({
      orgId,
      projectId,
      event: "issue.created",
      data: { id: "abc", key: "WEB-000001", title: "[vitest] signed" },
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(received.length).toBeGreaterThan(0);
    const r = received[received.length - 1];

    expect(r.headers["x-bugtracker-event"]).toBe("issue.created");
    const ts = r.headers["x-bugtracker-timestamp"];
    const sig = r.headers["x-bugtracker-signature"];
    expect(ts).toBeTruthy();
    expect(sig?.startsWith("sha256=")).toBe(true);

    // the real check: the signature validates against the secret we were given
    expect(verifySignature(hook.secret, ts, r.body, sig)).toBe(true);
    // and not against a different secret
    expect(verifySignature("whsec_wrong", ts, r.body, sig)).toBe(false);

    const payload = JSON.parse(r.body);
    expect(payload.event).toBe("issue.created");
    expect(payload.data.key).toBe("WEB-000001");

    await actingAs("you@shani.dev", () => deleteWebhook(hook.id));
  });

  it("only delivers subscribed events", async () => {
    received = [];
    const hook = await makeHook(["status.changed"]);
    if (!hook.ok) return;

    await dispatchWebhooks({ orgId, projectId, event: "issue.created", data: {} });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(0);

    await dispatchWebhooks({ orgId, projectId, event: "status.changed", data: {} });
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).toBeGreaterThan(0);

    await actingAs("you@shani.dev", () => deleteWebhook(hook.id));
  });

  it("does not deliver another organization's events", async () => {
    received = [];
    const hook = await makeHook(["issue.created"]);
    if (!hook.ok) return;

    await dispatchWebhooks({ orgId: "some-other-org-id", event: "issue.created", data: {} });
    await new Promise((r) => setTimeout(r, 250));
    expect(received).toHaveLength(0);

    await actingAs("you@shani.dev", () => deleteWebhook(hook.id));
  });

  it("skips disabled hooks", async () => {
    received = [];
    const hook = await makeHook(["issue.created"]);
    if (!hook.ok) return;
    await actingAs("you@shani.dev", () => setWebhookEnabled(hook.id, false));

    await dispatchWebhooks({ orgId, projectId, event: "issue.created", data: {} });
    await new Promise((r) => setTimeout(r, 250));
    expect(received).toHaveLength(0);

    await actingAs("you@shani.dev", () => deleteWebhook(hook.id));
  });

  it("records failures without throwing, and logs the attempt", async () => {
    received = [];
    respondWith = 500;
    const hook = await makeHook(["issue.created"]);
    if (!hook.ok) return;

    // must not reject — a broken receiver cannot break the triggering action
    await expect(
      dispatchWebhooks({ orgId, projectId, event: "issue.created", data: {} }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 400));

    const row = await prisma.webhook.findUnique({ where: { id: hook.id } });
    expect(row!.lastStatus).toBe(500);
    expect(row!.lastError).toContain("500");
    expect(row!.failureCount).toBeGreaterThan(0);

    const deliveries = await prisma.webhookDelivery.findMany({ where: { webhookId: hook.id } });
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries[0].statusCode).toBe(500);

    respondWith = 200;
    await actingAs("you@shani.dev", () => deleteWebhook(hook.id));
  });

  it("survives an unreachable endpoint", async () => {
    const res = await actingAs("you@shani.dev", () =>
      // nothing listening on this port
      createWebhook({ name: "[vitest] dead", url: "http://127.0.0.1:1/hook", events: ["issue.created"] }),
    );
    if (!res.ok) throw new Error(res.error);

    await expect(
      dispatchWebhooks({ orgId, projectId, event: "issue.created", data: {} }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 500));

    const row = await prisma.webhook.findUnique({ where: { id: res.id } });
    expect(row!.lastError).toBeTruthy();

    await actingAs("you@shani.dev", () => deleteWebhook(res.id));
  });
});

describe("test delivery", () => {
  it("sends a signed ping and reports the result", async () => {
    received = [];
    respondWith = 200;
    const hook = await makeHook(["issue.created"]);
    if (!hook.ok) return;

    const res = await actingAs("you@shani.dev", () => testWebhook(hook.id));
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);

    const r = received[received.length - 1];
    expect(r.headers["x-bugtracker-event"]).toBe("ping");
    expect(
      verifySignature(hook.secret, r.headers["x-bugtracker-timestamp"], r.body, r.headers["x-bugtracker-signature"]),
    ).toBe(true);

    await actingAs("you@shani.dev", () => deleteWebhook(hook.id));
  });

  it("refuses a webhook id from another organization", async () => {
    const other = await prisma.organization.create({
      data: { name: "[vitest] WH2", slug: "vitest-wh2-" + Date.now(), logoColor: "#000" },
    });
    const user = await prisma.user.create({
      data: { name: "[vitest] wh", email: `vitest-wh-${Date.now()}@x.test`, orgId: other.id },
    });
    await prisma.membership.create({ data: { orgId: other.id, userId: user.id, role: "owner" } });
    const foreign = await prisma.webhook.create({
      data: {
        orgId: other.id, name: "[vitest] foreign", url: url(),
        secret: "whsec_foreign", events: "issue.created", createdById: user.id,
      },
    });

    await expect(actingAs("you@shani.dev", () => testWebhook(foreign.id))).rejects.toThrow();
    await expect(actingAs("you@shani.dev", () => deleteWebhook(foreign.id))).rejects.toThrow();
    expect(await prisma.webhook.findUnique({ where: { id: foreign.id } })).not.toBeNull();

    await prisma.webhook.deleteMany({ where: { orgId: other.id } });
    await prisma.membership.deleteMany({ where: { orgId: other.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
