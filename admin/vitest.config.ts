import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config for the admin dashboard. Tests run under happy-dom
// rather than jsdom — happy-dom is significantly lighter and covers
// everything we need (DOM, events, simple form behavior). The React
// plugin is required so .tsx test files compile.
//
// We deliberately do NOT load Next.js's compiler. The tests render
// individual components in isolation; anything that would need
// next/server (e.g. cookies/auth) is mocked from each spec.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["test/**/*.spec.{ts,tsx}"],
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // PERF — admin tests render components in isolation with no shared
    // backend, DB, or filesystem state. Threads beat the default forks
    // pool for this CPU-bound workload; cap at four workers so CI
    // runners with limited cores don't oversubscribe.
    pool: "threads",
    poolOptions: {
      threads: { singleThread: false, minThreads: 1, maxThreads: 4 },
    },
    // `server-only` is a Next.js-provided marker module that has no
    // implementation outside the Next.js bundler. Tests that import
    // server-only modules (e.g. admin-client) need a stub so the import
    // doesn't fail under vitest.
    alias: {
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
