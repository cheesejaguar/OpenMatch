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
  },
});
