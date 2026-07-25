import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/auth";
import { generateToken, TOKEN_PREFIX } from "@/lib/api-auth";

describe("password hashing", () => {
  it("produces a versioned scrypt hash carrying its cost parameters", async () => {
    const h = await hashPassword("correct horse battery staple");
    const parts = h.split("$");
    expect(parts[0]).toBe("scrypt");
    expect(parts).toHaveLength(6); // scrypt$N$r$p$salt$hash
    expect(Number(parts[1])).toBeGreaterThanOrEqual(1 << 14);
    expect(parts[4]).toHaveLength(32); // 16-byte salt
    expect(parts[5]).toHaveLength(128); // 64-byte key
  });

  it("never stores the plaintext", async () => {
    const h = await hashPassword("hunter2hunter2");
    expect(h).not.toContain("hunter2");
  });

  it("salts: the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
    // ...but both still verify
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphrase", h)).toBe(true);
    expect(await verifyPassword("s3cret-passphras", h)).toBe(false);
    expect(await verifyPassword("S3cret-passphrase", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    const malformed = [
      null,
      "",
      "notahash",
      "scrypt$",
      "scrypt$abc$def",
      "bcrypt$32768$8$1$" + "a".repeat(32) + "$" + "b".repeat(128),
      "scrypt$zz$8$1$" + "a".repeat(32) + "$" + "b".repeat(128), // non-numeric N
      "scrypt$32768$8$1$zz$" + "b".repeat(128), // non-hex salt
      "scrypt$32768$8$1$" + "a".repeat(32) + "$zz", // non-hex key
      "scrypt$999999999$8$1$" + "a".repeat(32) + "$" + "b".repeat(128), // absurd cost
    ];
    for (const stored of malformed) {
      await expect(verifyPassword("anything", stored as string | null)).resolves.toBe(false);
    }
  });

  it("still verifies the legacy 3-field format", async () => {
    // pre-versioning hashes must keep working after the format change
    const { scrypt: _s } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const scrypt = promisify(_s) as (p: string, s: Buffer, k: number, o: any) => Promise<Buffer>;
    const salt = Buffer.from("a".repeat(32), "hex");
    const key = await scrypt("legacy-pw", salt, 64, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const legacy = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
    expect(await verifyPassword("legacy-pw", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });
});

describe("login timing oracle", () => {
  // Regression: the dummy hash was malformed and short-circuited, so an
  // unknown email returned ~instantly while a real one paid for a full scrypt.
  it("the unknown-email dummy hash performs real work", async () => {
    const real = await hashPassword("some-password");

    const time = async (fn: () => Promise<unknown>) => {
      const s = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - s) / 1e6;
    };

    await verifyPassword("warmup", real); // JIT warm-up

    const known = await time(() => verifyPassword("wrong-password", real));
    const unknown = await time(() => verifyPassword("wrong-password", DUMMY_PASSWORD_HASH));

    expect(unknown).toBeGreaterThan(5); // did actual KDF work
    const ratio = Math.max(known, unknown) / Math.min(known, unknown);
    expect(ratio).toBeLessThan(3);
  });

  it("the dummy hash never authenticates anything", async () => {
    for (const guess of ["", "password", "a".repeat(64), DUMMY_PASSWORD_HASH]) {
      expect(await verifyPassword(guess, DUMMY_PASSWORD_HASH)).toBe(false);
    }
  });
});

describe("API token generation", () => {
  it("is prefixed, high-entropy and stored only as a hash", () => {
    const { raw, tokenHash, prefix } = generateToken();
    expect(raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(raw.length).toBeGreaterThan(30);
    expect(tokenHash).toHaveLength(64); // sha-256 hex
    expect(tokenHash).not.toContain(raw);
    expect(raw.startsWith(prefix)).toBe(true);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken().raw));
    expect(seen.size).toBe(200);
  });
});
