# OpenMatch SDKs

Auto-generated client libraries for the OpenMatch backend.

| Language | Path | Status | Generator |
|---|---|---|---|
| **TypeScript** | [`typescript/`](typescript/) | Generated | [`scripts/gen-sdk.mjs`](../scripts/gen-sdk.mjs) + [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) |
| **Swift** | `swift/` | Not generated upstream — requires Java. See [`docs/forking.md`](../docs/forking.md#11-regenerate-the-typescript-sdk). | [`openapi-generator-cli`](https://github.com/OpenAPITools/openapi-generator-cli) `-g swift5` |

## Regenerate

```bash
# Backend must be running on http://localhost:8080
npm run gen:sdk

# Or from an offline snapshot
OPENAPI_FILE=sdk/openapi.json npm run gen:sdk
```

## Drift detection

The [`sdk-drift`](../.github/workflows/sdk-drift.yml) GitHub Action
boots the backend in CI, regenerates the SDK, and fails the PR if the
result doesn't match what's committed. This keeps the generated
client honest with the source schema.

## Source of truth

The schema lives in the live backend's OpenAPI 3.1 document at
[`/openapi.json`](http://localhost:8080/openapi.json) (also served at
[`/docs`](http://localhost:8080/docs) as an interactive UI).

`sdk/openapi.json` in this directory is a snapshot of that document
at the time of the last regeneration. It exists so the SDK is
regenerable without running the backend.
