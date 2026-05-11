import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    testTimeout: 20_000,
    // The integration suite shares a single Postgres database and each
    // file's beforeEach issues `TRUNCATE … CASCADE` across the same
    // tables. Running spec files in parallel triggers deadlocks on
    // those TRUNCATEs and lets one file observe partially-reset state
    // from another. Force sequential execution.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
