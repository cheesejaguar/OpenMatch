import { z } from "zod";

// Server-only env. Importing this file from a client component MUST fail
// at build time — never re-export these values to the browser.

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ADMIN_API_BASE_URL: z.string().url().default("http://localhost:8080"),
  ADMIN_SESSION_SECRET: z.string().min(16).default("dev-session-secret-please-change-me-please"),
  // PRD §8.7: preview deployments must not access production by default.
  ADMIN_ALLOW_PREVIEW_PROD: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function assertNoPreviewToProd(apiBaseUrl: string): void {
  const e = env();
  if (
    e.VERCEL_ENV === "preview" &&
    /prod|production/.test(apiBaseUrl) &&
    !e.ADMIN_ALLOW_PREVIEW_PROD
  ) {
    throw new Error(
      "Refusing to call production admin API from a preview deployment. Set ADMIN_ALLOW_PREVIEW_PROD=true to override.",
    );
  }
}
