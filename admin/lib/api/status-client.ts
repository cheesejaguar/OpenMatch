import "server-only";

import { env } from "../env";

// Public status-page client. Unlike the admin client, this:
//   - does NOT attach a session cookie (the endpoint is unauthenticated)
//   - does NOT redirect on 401 (no auth involved)
//   - keeps a short revalidation window so refresh-storms during an
//     outage don't hammer the backend.
//
// We hit the same Fastify backend the admin uses, but the path is
// `/api/v1/status/public` which is mounted before any auth hooks.

export type StatusHeadline = "normal" | "degraded" | "incident" | "unknown";

export interface ServiceSummary {
  key: "backend" | "admin" | "push" | "realtime";
  label: string;
  status: StatusHeadline;
  uptime90d: number | null;
  uptime24h: number | null;
}

export interface DailyUptimePoint {
  day: string;
  passRate: number | null;
  passed: number;
  total: number;
}

export interface IncidentUpdateDTO {
  id: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  title: string;
  body: string;
  postedAt: string;
}

export interface IncidentSummary {
  incidentKey: string;
  title: string;
  status: IncidentUpdateDTO["status"];
  severity: "none" | "minor" | "major" | "critical";
  service: string;
  startedAt: string;
  updatedAt: string;
  updates: IncidentUpdateDTO[];
}

export interface PublicStatusDTO {
  generatedAt: string;
  headline: StatusHeadline;
  headlineMessage: string;
  services: ServiceSummary[];
  uptime90d: DailyUptimePoint[];
  activeIncidents: IncidentSummary[];
  recentResolved: IncidentSummary[];
}

export async function fetchPublicStatus(): Promise<PublicStatusDTO | null> {
  const url = new URL("/api/v1/status/public", env().ADMIN_API_BASE_URL).toString();
  try {
    const res = await fetch(url, {
      // The backend caches for 15 s; mirror that here so Next's RSC
      // cache doesn't keep stale data on screen during an outage but
      // also doesn't fan out on every render.
      next: { revalidate: 15 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicStatusDTO;
  } catch {
    // Treat any network/parse error as "status unknown" so the page
    // still renders a sane fallback rather than crashing.
    return null;
  }
}
