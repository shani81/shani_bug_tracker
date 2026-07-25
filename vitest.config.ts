import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // The e2e webhook suite runs a receiver on 127.0.0.1; the SSRF guard is
    // fail-closed by default, so tests opt in explicitly.
    env: { ALLOW_PRIVATE_WEBHOOK_TARGETS: "1" },
    // Suites share one SQLite file and mutate rows, so they must not interleave.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      // `server-only` throws outside a server component; harmless in tests.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      // Server actions read cookies/headers through these; vitest has no
      // request scope, so tests supply their own (see tests/stubs).
      "next/headers": path.resolve(__dirname, "tests/stubs/next-headers.ts"),
      "next/cache": path.resolve(__dirname, "tests/stubs/next-cache.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
