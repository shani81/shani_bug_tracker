# Tests

```bash
npm run test:unit    # pure logic — no server, no database writes
npm run test:e2e     # needs a dev server + seeded database
npm test             # everything
```

## Unit (`tests/unit`)

Pure functions, fast and hermetic:

- **`permissions.test.ts`** — the full capability matrix. Every org role × every
  capability, the project-role refinements, the org-role ceiling, and the
  `viewer` read-only clamp. If authorization drifts, this fails first.
- **`auth.test.ts`** — scrypt hashing (salting, the versioned `scrypt$N$r$p$…`
  format, legacy-format compatibility, malformed input) and API-token
  generation. Includes a timing check on the unknown-email path, which is what
  stops login from leaking which addresses have accounts.

## End-to-end (`tests/e2e`)

These drive a running server over HTTP and read/write the dev database.

```bash
npm run dev -- -p 3005      # in one terminal
npm run test:e2e            # in another
```

Point them elsewhere with `TEST_BASE_URL`. Each suite skips cleanly (rather
than failing) when no server is reachable, so `npm test` stays useful without
one — the unit tests still run.

- **`auth.test.ts`** — anonymous access is refused everywhere, forged and
  expired cookies are rejected, deactivated memberships lose access, session
  tokens are stored only as hashes.
- **`api.test.ts`** — token lifecycle, scope enforcement (a read token cannot
  mutate through *any* verb), RBAC through the API, cross-tenant isolation,
  pagination, and that a token can neither render an app page nor drive a
  server action.
- **`team.test.ts`** — invitation lifecycle, the settings gate, private
  comments, and both account-takeover variants (accounts with and without a
  password).

Rows created by tests are named or prefixed with `vitest` and cleaned up in
`afterAll`. Suites run serially (`fileParallelism: false`) because they share
one SQLite file.

## Notes

Several tests are regression guards for bugs found in adversarial review —
they're commented with what they protect. Please keep those comments if you
refactor: they explain why an assertion that looks redundant is not.
