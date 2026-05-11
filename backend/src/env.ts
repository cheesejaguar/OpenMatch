import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),

  // Upstash Redis (REST). Optional in local dev; rate-limit and cache fall
  // back to in-memory when both are absent.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().email().default("noreply@openmatch.local"),
  MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  APPLE_TEAM_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // Ably realtime fan-out for chat. Required in production for live message
  // delivery; if absent, POST /messages still works but no push is emitted.
  ABLY_API_KEY: z.string().optional(),

  // Vercel Blob token. Required to mint client upload tokens; if absent,
  // photo uploads fall back to a local filesystem path (dev only).
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // Public base URL the API answers on. Used to build absolute links in
  // outgoing email (magic links, etc.). In production set this to the
  // Vercel/Custom domain, e.g. https://api.openmatch.app.
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  ALLOW_DEV_LOGIN: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
