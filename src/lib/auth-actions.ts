"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, destroyCurrentSession, DUMMY_PASSWORD_HASH } from "@/lib/auth";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").max(200),
});

// ── Naive in-process throttle (per email+ip) ─────────────────────────────────
// Enough to blunt online brute force in a single-instance deployment. Swap for
// Redis/a rate-limit service when running multiple instances.
type Attempt = { count: number; first: number };
const globalForThrottle = globalThis as unknown as { __loginAttempts?: Map<string, Attempt> };
const attempts: Map<string, Attempt> = (globalForThrottle.__loginAttempts ??= new Map());

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const MAX_KEYS = 10_000;

/** Shared with other credential-checking endpoints (e.g. password change). */
export async function checkCredentialThrottle(key: string): Promise<boolean> {
  return isThrottled(key);
}
export async function recordCredentialFailure(key: string): Promise<void> {
  recordFailure(key);
}
export async function clearCredentialThrottle(key: string): Promise<void> {
  attempts.delete(key);
}

function isThrottled(key: string): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  // Bounded sweep so rotating keys cannot grow the map without limit.
  if (attempts.size > MAX_KEYS) {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of attempts) if (v.first < cutoff) attempts.delete(k);
  }
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

export type SignInState = { error?: string };

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials" };
  }
  const { email, password } = parsed.data;

  const h = await headers();

  // x-forwarded-for is client-controlled at the LEFTMOST position; trusted
  // proxies append, so take the RIGHTMOST hop. An attacker rotating the header
  // can no longer mint a fresh throttle bucket per request.
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : "local";

  // Three buckets, so no single axis of rotation grants unlimited attempts:
  //   email+ip  — the common case
  //   email     — IP rotation cannot grind one account
  //   ip        — email rotation cannot grind the user directory, and cannot
  //               be used to force unbounded concurrent KDF work
  const pairKey = `${email}|${ip}`;
  const emailKey = `email:${email}`;
  const ipOnlyKey = `ip:${ip}`;
  if (isThrottled(pairKey) || isThrottled(emailKey) || isThrottled(ipOnlyKey)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always run a REAL scrypt comparison, even for a nonexistent account, so the
  // unknown-email path costs the same as the wrong-password path. (A malformed
  // dummy would short-circuit on the length check and reintroduce the oracle.)
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !ok || !user.isActive) {
    recordFailure(pairKey);
    recordFailure(emailKey);
    recordFailure(ipOnlyKey);
    return { error: "Incorrect email or password." };
  }

  attempts.delete(pairKey);
  attempts.delete(emailKey);
  await createSession(user.id, { userAgent: h.get("user-agent") ?? "", ip });
  redirect("/");
}

export async function signOutAction() {
  await destroyCurrentSession();
  redirect("/login");
}

// NOTE: password-change/admin-reset deliberately does NOT live here. Every
// export of a "use server" module is a public RPC endpoint, so an unguarded
// setUserPassword() would be an unauthenticated account-takeover hole. When
// that flow is built it must: require member:manage (or the current password
// for self-service), verify the target shares the caller's org, and call
// destroyAllSessions(userId) so stolen cookies die with the old password.
