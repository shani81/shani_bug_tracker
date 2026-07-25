// Test-only stand-in for `next/headers`.
//
// Server actions read the session cookie through this module. Vitest has no
// request scope, so the real implementation throws. This lets a test act as a
// specific user by setting the cookie/header values it should see.
//
// Only wired in through vitest's alias config — production is untouched.

type Store = { cookie?: string; bearer?: string };

const g = globalThis as unknown as { __testAuth?: Store };
g.__testAuth ??= {};

/** Run `fn` as the holder of this session cookie. */
export async function withCookie<T>(cookie: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = g.__testAuth!.cookie;
  g.__testAuth!.cookie = cookie;
  try {
    return await fn();
  } finally {
    g.__testAuth!.cookie = prev;
  }
}

export async function cookies() {
  return {
    get: (name: string) =>
      name === "bt_session" && g.__testAuth?.cookie
        ? { name, value: g.__testAuth.cookie }
        : undefined,
    set: () => {},
    delete: () => {},
  };
}

export async function headers() {
  return {
    get: (name: string) => {
      const n = name.toLowerCase();
      if (n === "authorization" && g.__testAuth?.bearer) return `Bearer ${g.__testAuth.bearer}`;
      if (n === "host") return "localhost:3005";
      if (n === "x-forwarded-proto") return "http";
      return null;
    },
  };
}
