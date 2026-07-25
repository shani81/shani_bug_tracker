// `server-only` exists to fail the build if a server module is imported from a
// client component. Under vitest there is no such boundary, so it's a no-op.
export {};
