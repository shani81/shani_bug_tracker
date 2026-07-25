import "server-only";
import { lookup } from "node:dns/promises";

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard for user-supplied outbound URLs (webhooks).
//
// A webhook URL makes the SERVER issue a request to an address the user chose.
// Without this, anyone could point one at 169.254.169.254 to read cloud
// instance credentials, or at an internal service that trusts the network.
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

/** RFC1918 + loopback + link-local + CGNAT + unique-local IPv6. */
function isPrivateAddress(ip: string, family: number): boolean {
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    if (v.startsWith("fe80")) return true; // link local
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // unparseable → refuse
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validate a webhook target.
 *
 * `allowPrivate` exists so local development (and the test suite) can point a
 * hook at 127.0.0.1; it is never enabled in production.
 */
export async function checkOutboundUrl(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http and https URLs are supported." };
  }
  if (url.protocol === "http:" && process.env.NODE_ENV === "production" && !opts.allowPrivate) {
    return { ok: false, error: "Use https for webhook endpoints." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Credentials in the URL are not allowed." };
  }

  const allowPrivate = opts.allowPrivate ?? process.env.NODE_ENV !== "production";

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
      return { ok: false, error: "That host is not allowed." };
    }

    // Resolve so an innocent-looking name pointing at a private address is
    // caught too. (A determined attacker could still re-bind DNS between this
    // check and the request; blocking that needs pinning the resolved IP at
    // connect time, which Node's fetch does not expose.)
    try {
      const addrs = await lookup(host, { all: true });
      if (addrs.length === 0) return { ok: false, error: "That host could not be resolved." };
      for (const a of addrs) {
        if (isPrivateAddress(a.address, a.family)) {
          return { ok: false, error: "That URL resolves to a private address." };
        }
      }
    } catch {
      return { ok: false, error: "That host could not be resolved." };
    }
  }

  return { ok: true, url: url.toString() };
}
