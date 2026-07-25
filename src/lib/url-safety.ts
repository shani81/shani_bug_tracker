import "server-only";
import { lookup } from "node:dns/promises";

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard for user-supplied outbound URLs (webhooks).
//
// A webhook URL makes the SERVER issue a request to an address the user chose.
// Without this, anyone could point one at 169.254.169.254 to read cloud
// instance credentials, or at an internal service that trusts the network.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One message for every host-level rejection. Distinguishing "resolves to a
 * private address" from "could not be resolved" would let an admin map
 * internal DNS without sending a single request.
 */
const GENERIC_REJECTION =
  "That endpoint isn't reachable from here. Use a public https URL.";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * Expand an IPv6 address to exactly 8 numeric hextets, or null if unparseable.
 *
 * Matching on string prefixes is not enough: the URL parser rewrites
 * `::ffff:127.0.0.1` to `::ffff:7f00:1`, so a textual check for the dotted
 * form misses a mapped loopback address entirely.
 */
function expandIpv6(input: string): number[] | null {
  let s = input.toLowerCase().split("%")[0]; // drop any zone id

  // A trailing dotted-quad (::ffff:127.0.0.1) becomes two hextets.
  const dotted = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const [, head, a, b, c, d] = dotted;
    const oct = [a, b, c, d].map(Number);
    if (oct.some((n) => n > 255)) return null;
    s = head + ((oct[0] << 8) | oct[1]).toString(16) + ":" + ((oct[2] << 8) | oct[3]).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...Array(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

/** RFC1918 + loopback + link-local + CGNAT + unique-local IPv6. */
function isPrivateAddress(ip: string, family: number): boolean {
  if (family === 6) {
    const h = expandIpv6(ip);
    if (!h) return true; // unparseable → refuse

    const allZero = h.every((x) => x === 0);
    if (allZero) return true; // ::
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1

    // Anything that embeds an IPv4 address in its low 32 bits must be judged
    // by the IPv4 rules: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d),
    // IPv4-translated (::ffff:0:a.b.c.d) and NAT64 (64:ff9b::/96,
    // 64:ff9b:1::/48) all reach an IPv4 destination.
    const embedsIpv4 =
      (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) || // ::ffff:/96, ::/96
      (h.slice(0, 4).every((x) => x === 0) && h[4] === 0xffff && h[5] === 0) || // ::ffff:0:0/96
      (h[0] === 0x64 && h[1] === 0xff9b); // 64:ff9b::/96 and 64:ff9b:1::/48
    if (embedsIpv4) {
      const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
      return isPrivateAddress(v4, 4);
    }

    if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
    if (h[0] === 0x2002) return true; // 2002::/16 6to4 — wraps an arbitrary IPv4
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
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Whether private targets are permitted.
 *
 * Deliberately NOT keyed off NODE_ENV: `next start` only defaults that value,
 * so a platform setting NODE_ENV=staging would silently disable the entire
 * guard. Requires an explicit opt-in instead, so the default is always closed.
 */
function allowPrivateTargets(opts: { allowPrivate?: boolean }): boolean {
  if (typeof opts.allowPrivate === "boolean") return opts.allowPrivate;
  return process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS === "1";
}

/**
 * Validate a webhook target.
 *
 * `allowPrivate` (or ALLOW_PRIVATE_WEBHOOK_TARGETS=1) exists so local
 * development and the test suite can point a hook at 127.0.0.1. It defaults to
 * OFF, so forgetting to configure anything leaves the guard fully enabled.
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
  if (url.protocol === "http:" && !allowPrivateTargets(opts)) {
    return { ok: false, error: "Use https for webhook endpoints." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Credentials in the URL are not allowed." };
  }

  const allowPrivate = allowPrivateTargets(opts);

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
      return { ok: false, error: GENERIC_REJECTION };
    }

    // Resolve so an innocent-looking name pointing at a private address is
    // caught too.
    //
    // Known limitation: an attacker controlling DNS could still answer
    // differently between this lookup and the request itself (rebinding).
    // Closing that needs a custom undici dispatcher that connects to the IP
    // verified here rather than re-resolving. Dispatch re-runs this check on
    // every delivery, which bounds the exposure but does not eliminate it.
    try {
      const addrs = await lookup(host, { all: true });
      if (addrs.length === 0) return { ok: false, error: GENERIC_REJECTION };
      for (const a of addrs) {
        if (isPrivateAddress(a.address, a.family)) {
          return { ok: false, error: GENERIC_REJECTION };
        }
      }
    } catch {
      return { ok: false, error: GENERIC_REJECTION };
    }
  }

  return { ok: true, url: url.toString() };
}
