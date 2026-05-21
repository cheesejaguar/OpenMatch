import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output bundles only the files required at runtime into
  // `.next/standalone/` so the production Docker image stays small.
  // See admin/Dockerfile + docs/self-hosting.md. Vercel deployments
  // ignore this and use their own server build.
  output: "standalone",
  // PERF-A6 — strip `console.*` (except error/warn) from the prod bundle.
  // The admin codebase has informational `console.log` / `console.info` calls
  // in server actions + RSC fetches that pollute Vercel logs and ship to
  // every client bundle as dead weight.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  // PERF-A6 — tree-shake barrel imports from heavyweight packages. Free
  // win whenever an `import { X } from 'lucide-react'` (or similar) lands.
  // Listed pre-emptively so accidental barrel imports never balloon the
  // bundle.
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "react-hook-form", "zod"],
  },
  images: {
    // Vercel Blob CDN host pattern. The admin photo grids reference
    // `@vercel/blob` public URLs (see backend/src/lib/media.ts) which
    // are served from a `*.public.blob.vercel-storage.com` subdomain.
    // Listing them here lets `next/image` resize + reformat (WebP/AVIF)
    // those photos through the Vercel image optimizer.
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      // Admin route documents MUST NOT be cached by intermediaries
      // (PRD §11.3). The exclusion list keeps Next's content-hashed
      // static assets cacheable so navigation doesn't re-download
      // every JS/CSS chunk on each page transition.
      {
        source: "/((?!_next/static|_next/image|favicon|om-mark).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // Security headers should still apply to static assets — only
      // the Cache-Control is scoped.
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default config;
