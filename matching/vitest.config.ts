import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    // PERF — matching is pure-logic with no shared DB or filesystem
    // state, so spec files can run concurrently across worker threads.
    // The default `forks` pool spins one Node process per file, which
    // pays a much heavier per-file startup tax than threads. Cap at
    // four workers so CI runners with fewer cores don't oversubscribe.
    pool: "threads",
    poolOptions: {
      threads: { singleThread: false, maxThreads: 4 },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.d.ts"],
      // Matching has solid test coverage already; thresholds keep
      // future churn from regressing it.
      thresholds: {
        autoUpdate: false,
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
});
