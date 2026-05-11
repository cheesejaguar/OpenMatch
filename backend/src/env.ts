import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

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

  GCS_BUCKET: z.string().optional().default(""),
  GCS_PROJECT: z.string().optional().default(""),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  ALLOW_DEV_LOGIN: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
