import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import { env } from "../env.js";

// Round C — Hosts the OpenAPI 3.1 document for the public API and a
// Swagger UI viewer at /api-docs.
//
// Why a dedicated plugin: the spec ships through CI to the docs site and
// is consumed by client-code generators; centralising the wiring keeps
// the security-scheme and the public/internal route filter in one place
// instead of scattered across server.ts.
//
// Routes registered under /api/v1/internal/* (worker cron endpoints) and
// /api/v1/admin/* (RBAC-gated dashboard endpoints) are hidden from the
// public document. They're tracked separately in the admin OpenAPI build
// if/when we expose those — but they intentionally never go into the
// client-facing spec.
//
// NOTE: This plugin must be registered BEFORE every `app.register(routes,
// …)` call so the schemas attached to those routes feed into the spec.
//
// Wrapped in fastify-plugin so the `app.swagger()` decorator from
// @fastify/swagger is exposed on the parent context (otherwise it stays
// trapped inside this plugin's encapsulated scope and the GET
// /openapi.json handler can't see it).
async function openapiPluginImpl(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "OpenMatch API",
        version: "0.1.0",
        description:
          "OpenMatch is an open-source dating app with an auditable matching algorithm and no paid dating advantage.",
      },
      servers: [{ url: env.APP_BASE_URL || `http://${env.HOST}:${env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Short-lived user access token issued by /api/v1/auth/verify.",
          },
          adminBearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Short-lived admin access token issued by /api/v1/admin/auth/verify.",
          },
        },
      },
    },
    // Use the Zod transform from fastify-type-provider-zod for routes
    // that opt in via `.withTypeProvider<ZodTypeProvider>()`; routes
    // without a Zod schema fall through unchanged so they still appear
    // in the document as schema-less paths.
    transform: (params) => {
      const { schema, url } = params;
      // Hide internal worker + admin endpoints from the public doc. They
      // remain reachable on the server — they just don't surface in the
      // client-facing spec.
      if (url.startsWith("/api/v1/internal") || url.startsWith("/api/v1/admin")) {
        return {
          schema: { ...(schema ?? {}), hide: true },
          url,
        };
      }
      // Detect Zod-using routes by sniffing for a `_zod` field on the
      // schema parts. Other routes return the schema as-is so they still
      // surface in the spec.
      const looksZod = (s: unknown) =>
        s !== null && typeof s === "object" && "_zod" in (s as Record<string, unknown>);
      const hasZod =
        looksZod((schema as { body?: unknown })?.body) ||
        looksZod((schema as { querystring?: unknown })?.querystring) ||
        looksZod((schema as { params?: unknown })?.params) ||
        looksZod((schema as { headers?: unknown })?.headers);
      if (hasZod) {
        return jsonSchemaTransform(params);
      }
      return { schema: schema ?? {}, url };
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/api-docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: true,
  });

  // Machine-readable spec for client-code generators / docs site.
  app.get("/openapi.json", async () => app.swagger());
}

export const openapiPlugin = fp(openapiPluginImpl, { name: "openapi" });
