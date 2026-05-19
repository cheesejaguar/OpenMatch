import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
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
