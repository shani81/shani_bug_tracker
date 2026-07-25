import { describe, it, expect } from "vitest";
import { signPayload, verifySignature, generateSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { checkOutboundUrl } from "@/lib/url-safety";

describe("payload signing", () => {
  const secret = "whsec_test_key";
  const ts = "1700000000000";
  const body = JSON.stringify({ event: "issue.created", data: { id: "abc" } });

  it("produces a stable sha256= signature", () => {
    const sig = signPayload(secret, ts, body);
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(sig).toBe(signPayload(secret, ts, body));
    expect(sig).toHaveLength(7 + 64);
  });

  it("verifies a correct signature", () => {
    expect(verifySignature(secret, ts, body, signPayload(secret, ts, body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signPayload(secret, ts, body);
    const tampered = JSON.stringify({ event: "issue.created", data: { id: "xyz" } });
    expect(verifySignature(secret, ts, tampered, sig)).toBe(false);
  });

  it("rejects a replay under a different timestamp", () => {
    // the timestamp is inside the signed material, so it cannot be swapped
    const sig = signPayload(secret, ts, body);
    expect(verifySignature(secret, "1700000009999", body, sig)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const sig = signPayload(secret, ts, body);
    expect(verifySignature("whsec_other", ts, body, sig)).toBe(false);
  });

  it("rejects malformed signatures without throwing", () => {
    for (const bad of ["", "sha256=", "nonsense", "sha256=" + "0".repeat(63)]) {
      expect(verifySignature(secret, ts, body, bad)).toBe(false);
    }
  });

  it("generates distinct, prefixed secrets", () => {
    const secrets = new Set(Array.from({ length: 100 }, generateSecret));
    expect(secrets.size).toBe(100);
    expect([...secrets][0].startsWith("whsec_")).toBe(true);
  });

  it("exposes the documented event list", () => {
    expect(WEBHOOK_EVENTS).toContain("issue.created");
    expect(WEBHOOK_EVENTS).toContain("status.changed");
  });
});

describe("SSRF guard", () => {
  // Production semantics: private targets are refused. (In dev the guard is
  // relaxed so a local receiver can be used, so force the strict path here.)
  const strict = { allowPrivate: false };

  it("accepts a public address", async () => {
    // A public IP literal, so the assertion does not depend on DNS being
    // reachable from wherever the suite runs.
    const res = await checkOutboundUrl("https://93.184.216.34/hooks/bug-tracker", strict);
    expect(res.ok).toBe(true);
  });

  it("fails closed when a host cannot be resolved", async () => {
    const res = await checkOutboundUrl("https://nx-domain.invalid/hook", strict);
    expect(res.ok).toBe(false);
  });

  it("refuses loopback and localhost", async () => {
    for (const url of [
      "http://localhost:3000/hook",
      "http://127.0.0.1/hook",
      "https://127.0.0.1:8443/hook",
      "http://[::1]/hook",
    ]) {
      const res = await checkOutboundUrl(url, strict);
      expect(res.ok, url).toBe(false);
    }
  });

  it("refuses cloud metadata and private ranges", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/", // AWS/Azure/GCP metadata
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://10.0.0.5/hook",
      "http://172.16.4.4/hook",
      "http://192.168.1.10/hook",
      "http://100.64.0.1/hook", // CGNAT
      "http://0.0.0.0/hook",
    ]) {
      const res = await checkOutboundUrl(url, strict);
      expect(res.ok, url).toBe(false);
    }
  });

  it("refuses non-http schemes", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/",
      "javascript:alert(1)",
    ]) {
      const res = await checkOutboundUrl(url, strict);
      expect(res.ok, url).toBe(false);
    }
  });

  it("refuses embedded credentials", async () => {
    const res = await checkOutboundUrl("https://user:pass@example.com/hook", strict);
    expect(res.ok).toBe(false);
  });

  it("refuses malformed input", async () => {
    for (const url of ["", "   ", "not a url", "http://"]) {
      expect((await checkOutboundUrl(url, strict)).ok, url).toBe(false);
    }
  });

  it("allows private targets only when explicitly permitted", async () => {
    expect((await checkOutboundUrl("http://127.0.0.1:9999/hook", { allowPrivate: true })).ok).toBe(true);
    expect((await checkOutboundUrl("http://127.0.0.1:9999/hook", strict)).ok).toBe(false);
  });
});
