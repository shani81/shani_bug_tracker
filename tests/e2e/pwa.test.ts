import { describe, it, expect, beforeAll } from "vitest";
import { BASE, serverIsUp } from "../helpers";

// These assert the criteria Chrome on Android actually enforces before it will
// offer "Add to home screen". Chrome requests the manifest, service worker and
// icons WITHOUT credentials, so every one must be reachable signed out.

let up = false;
beforeAll(async () => {
  up = await serverIsUp();
});

describe("web app manifest", () => {
  it("is served to an anonymous visitor as JSON", async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/manifest.webmanifest`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("manifest");
  });

  it("declares everything Android needs", async () => {
    if (!up) return;
    const m = await fetch(`${BASE}/manifest.webmanifest`).then((r) => r.json());
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBeTruthy();
    expect(m.background_color).toBeTruthy();

    const icons: { sizes: string; purpose?: string }[] = m.icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512")).toBe(true);
    // adaptive launcher icons
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(Array.isArray(m.shortcuts) && m.shortcuts.length > 0).toBe(true);
  });

  it("serves every declared icon as a real PNG of the stated size", async () => {
    if (!up) return;
    const m = await fetch(`${BASE}/manifest.webmanifest`).then((r) => r.json());
    for (const icon of m.icons as { src: string; sizes: string }[]) {
      const res = await fetch(BASE + icon.src, { redirect: "manual" });
      expect(res.status, icon.src).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 8).toString("hex"), icon.src).toBe("89504e470d0a1a0a");
      expect(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
  });
});

describe("service worker", () => {
  it("is served anonymously and has a fetch handler", async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/sw.js`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const body = await res.text();
    // Chrome requires a fetch handler before it treats the app as installable
    expect(body).toContain('addEventListener("fetch"');
    expect(body).toContain("/offline");
  });

  // The security property: a shared or stolen device must not yield another
  // user's issues out of the cache after sign-out.
  it("never caches API responses", async () => {
    if (!up) return;
    const body = await fetch(`${BASE}/sw.js`).then((r) => r.text());
    expect(body).toContain('url.pathname.startsWith("/api/")');
    expect(body).toContain("clear-caches");
  });
});

describe("offline fallback", () => {
  it("renders without a session", async () => {
    if (!up) return;
    const res = await fetch(`${BASE}/offline`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain("offline");
  });
});

describe("document wiring", () => {
  it("links the manifest and sets the Android status-bar colour", async () => {
    if (!up) return;
    const html = await fetch(`${BASE}/login`).then((r) => r.text());
    expect(/rel="manifest"/.test(html)).toBe(true);
    expect(/name="theme-color"/.test(html)).toBe(true);
    expect(/apple-touch-icon/.test(html)).toBe(true);
    expect(/viewport-fit=cover/.test(html)).toBe(true);
  });
});
