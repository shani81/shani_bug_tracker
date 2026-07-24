import "server-only";
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

type ScryptOpts = { N: number; r: number; p: number; maxmem: number };
const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOpts,
) => Promise<Buffer>;

// ── Password hashing (scrypt — no external dependency) ───────────────────────

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

// Cost parameters are stored *inside* each hash, so these can be raised later
// without invalidating existing passwords — old hashes keep verifying with the
// parameters they were created with.
const SCRYPT_PARAMS = { N: 1 << 16, r: 8, p: 1 } as const;
// 128 * N * r bytes, plus headroom; the default 32MB cap would reject N=2^16.
const MAX_MEM = 256 * 1024 * 1024;

const isHex = (s: string) => s.length > 0 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);

/** Produce "scrypt$N$r$p$saltHex$hashHex". */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, { N, r, p, maxmem: MAX_MEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Constant-time password check. Never throws on malformed input.
 * Accepts the current 6-field format and the original 3-field one.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return false;

  let saltHex: string, hashHex: string, N: number, r: number, p: number;
  if (parts.length === 6) {
    [, , , , saltHex, hashHex] = parts;
    N = Number(parts[1]);
    r = Number(parts[2]);
    p = Number(parts[3]);
  } else if (parts.length === 3) {
    [, saltHex, hashHex] = parts;
    ({ N, r, p } = { N: 1 << 14, r: 8, p: 1 }); // Node defaults, pre-versioning
  } else {
    return false;
  }

  // Node's hex decoder truncates at the first invalid character instead of
  // throwing, so validate before decoding.
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 2 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  if (!isHex(saltHex) || !isHex(hashHex)) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (salt.length !== SALT_BYTES || expected.length !== SCRYPT_KEYLEN) return false;
    const actual = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, { N, r, p, maxmem: MAX_MEM });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A structurally valid hash of an unguessable value. Verifying against this for
 * an unknown email costs the same as a real check, so response time does not
 * reveal whether an account exists.
 */
export const DUMMY_PASSWORD_HASH =
  `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$` +
  `${"a".repeat(SALT_BYTES * 2)}$${"b".repeat(SCRYPT_KEYLEN * 2)}`;

// ── Session tokens ───────────────────────────────────────────────────────────

export const SESSION_COOKIE = "bt_session";
const SESSION_DAYS = 30;

/** Only the hash is persisted; the raw token lives solely in the user's cookie. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta?: { userAgent?: string; ip?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 300) ?? "",
      ip: meta?.ip ?? "",
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return { token, expiresAt };
}

/** Resolve the signed-in user from the cookie. Returns null when unauthenticated. */
export const getSessionUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    // never select passwordHash — this object is passed toward the UI layer
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          color: true,
          title: true,
          isActive: true,
          orgId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!session) return null;

  // expired or disabled account -> treat as signed out
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.isActive) return null;

  return session.user;
});

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Invalidate every session for a user (e.g. after a password change). */
export async function destroyAllSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
