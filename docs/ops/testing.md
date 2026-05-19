# Testing rigor

This doc covers the testing surfaces added in Round C — per-file coverage
pinning, property-based tests, contract snapshots, and the OpenAPI spec.

## Backend coverage

The backend test suite runs against a real Postgres + PostGIS database
(CI provisions a service container, locally use the `omq-c-pg` compose
container). Each spec file resets the shared tables in `beforeEach`.

```sh
# Local
docker run -d --name omq-c-pg -e POSTGRES_USER=openmatch \
  -e POSTGRES_PASSWORD=openmatch -e POSTGRES_DB=openmatch \
  -p 5433:5432 postgis/postgis:16-3.4
DATABASE_URL=postgresql://openmatch:openmatch@localhost:5433/openmatch?schema=public \
  npx prisma migrate deploy --schema backend/prisma/schema.prisma

# Run with coverage
DATABASE_URL=... JWT_SECRET=ci-only-secret-not-a-real-secret-do-not-use \
  ADMIN_JWT_SECRET=ci-only-admin-secret-not-a-real-secret \
  npm test -w @openmatch/backend -- --coverage
```

`backend/coverage/index.html` opens the per-file report; CI also uploads
the same files as an `backend-coverage` artifact on every run.

### Thresholds

`backend/vitest.config.ts` enforces a workspace floor (70% lines, 70%
statements, 70% functions, 65% branches) plus per-file pins for the
hot-path services:

| File | Min lines | Min branches |
| --- | --- | --- |
| `src/services/auth.service.ts` | 80 | 75 |
| `src/services/admin/auth.service.ts` | 80 | 75 |
| `src/services/admin/totp.service.ts` | 80 | 75 |
| `src/services/discovery.service.ts` | 70 | 60 |
| `src/services/chat.service.ts` | 70 | 60 |
| `src/services/swipe.service.ts` | 75 | 70 |
| `src/services/dsa.service.ts` | 75 | 70 |
| `src/workers/deletion.ts` | 75 | 70 |
| `src/workers/dsa-sla.ts` | 75 | 70 |
| `src/workers/alerter.ts` | 70 | 60 |
| `src/lib/flags.ts` | 85 | 75 |
| `src/lib/invite-codes.ts` | 85 | 80 |
| `src/lib/http-error.ts` | 90 | 80 |

When you add code to one of these files, also extend the matching spec
or coverage will regress below the pin and CI will fail. When you add a
new hot-path service, add a pin for it here too — the workspace floor
alone is not enough to catch a single high-risk service silently
dropping below 50%.

## Property-based tests (fast-check)

Property tests live under `backend/test/properties/`. They use
[`fast-check`](https://github.com/dubzzz/fast-check) to generate 100ish
randomised inputs per property and assert an invariant holds for every
one.

Add a new property:

```ts
import fc from "fast-check";
import { describe, it } from "vitest";

describe("my-invariant", () => {
  it("output is always non-negative", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (n) => {
        return myFunction(n) >= 0;
      }),
      { numRuns: 100 },
    );
  });
});
```

Guidelines:

- Keep each property under ~500 ms. Use `numRuns: 100` for pure-function
  properties; drop to 5–10 for DB-backed ones.
- For DB-backed properties, seed shared fixtures _outside_ `fc.assert`
  and only randomise inputs inside.
- Prefer `fc.asyncProperty(...)` + `await fc.assert(...)` for any
  property that hits a `Promise`.

## Contract snapshot tests

`backend/test/contracts/dto-snapshots.spec.ts` pins the shape of every
public DTO via `toMatchInlineSnapshot()`. When you change a DTO field
(rename, type swap, addition, removal):

1. Run the spec with `--update`:
   ```sh
   npx vitest run --root backend test/contracts/dto-snapshots.spec.ts -u
   ```
2. Review the inline-snapshot diff in your PR — every change here is a
   client-visible contract change.
3. Update the iOS Codable model and the admin TypeScript types in the
   same PR.

## OpenAPI spec

`backend/src/plugins/openapi.ts` registers `@fastify/swagger` and exposes
the document at:

- `GET /openapi.json` — machine-readable spec (OpenAPI 3.1).
- `GET /api-docs/` — Swagger UI (development convenience).

Internal worker endpoints (`/api/v1/internal/*`) and admin RBAC
endpoints (`/api/v1/admin/*`) are hidden from the public document.

Generating a client from the spec:

```sh
# Boot the server
DATABASE_URL=... npm run dev -w @openmatch/backend &
# Pull the spec
curl http://localhost:8080/openapi.json > openmatch-api.json
# Feed it to whatever generator you use
```

## Error-code sync

`scripts/sync-error-codes.mjs` regenerates `admin/lib/api/error-codes.ts`
from `backend/src/lib/error-codes.ts`. CI runs it followed by
`git diff --exit-code`, so when you add a backend code you also need to
run the script and commit the regenerated admin file.

```sh
node scripts/sync-error-codes.mjs
git add admin/lib/api/error-codes.ts
```
