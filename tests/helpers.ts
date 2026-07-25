import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
export const prisma = new PrismaClient({ adapter });

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3005";
export const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Create a real session row; returns the raw cookie value. */
export async function sessionFor(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no seeded user ${email} — run \`npm run db:seed\``);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return { token, user };
}

/** Create a real API token; returns the raw bearer value. */
export async function tokenFor(email: string, scopes: "read" | "read,write" = "read") {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no seeded user ${email}`);
  const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
  const raw = "bt_" + randomBytes(24).toString("base64url");
  const row = await prisma.apiToken.create({
    data: {
      name: "vitest",
      tokenHash: sha256(raw),
      prefix: raw.slice(0, 9),
      scopes,
      userId: user.id,
      orgId: membership!.orgId,
    },
  });
  return { raw, id: row.id, user };
}

export async function getPage(path: string, cookie?: string) {
  const res = await fetch(BASE + path, {
    headers: cookie ? { Cookie: `bt_session=${cookie}` } : {},
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") ?? "", body: await res.text() };
}

export async function api(path: string, bearer?: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

/** Remove every row this test run created. */
export async function cleanupTestArtifacts() {
  await prisma.apiToken.deleteMany({ where: { name: "vitest" } });
  await prisma.invitation.deleteMany({ where: { email: { contains: "vitest" } } });
  await prisma.issue.deleteMany({ where: { title: { contains: "[vitest]" } } });
}

/**
 * Run `fn` as the given user, by putting a real session cookie where the
 * stubbed `next/headers` will find it. Lets tests exercise server actions
 * directly instead of only over HTTP.
 */
export async function actingAs<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const { token } = await sessionFor(email);
  const { withCookie } = await import("./stubs/next-headers");
  try {
    return await withCookie(token, fn);
  } finally {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
}

/** Skip an e2e suite cleanly when no dev server is listening. */
export async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE + "/login", { redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}
