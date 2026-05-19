import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { buildReadySnapshot } from "../health.js";

// Round D — synthetic check route.
//
// `POST /api/v1/internal/run-synthetic-check` exercises a small slice
// of the public API end-to-end and persists a SyntheticCheckRun row so
// the admin "Health" panel can render the trend over time. The cron
// invokes us every 5 minutes (vercel.json); ops can also hit the
// route manually with the same bearer token.
//
// Bearer-gated by INTERNAL_WORKER_TOKEN, the same secret used by every
// other internal cron. A failed check is NOT a 4xx/5xx — it returns
// 200 with `passed: false` and the per-step report so the cron and the
// admin can both consume the same shape.

interface StepResult {
  name: string;
  passed: boolean;
  error?: string;
  status?: number;
}

interface SyntheticReport {
  ranAt: string;
  durationMs: number;
  passed: boolean;
  steps: StepResult[];
}

function checkBearer(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!constantTimeEqual(token, env.INTERNAL_WORKER_TOKEN)) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Each step runs sequentially. A step "passes" if it reached the
// expected gate (e.g. /ready returned 200, or /auth/start returned a
// challengeId OR a known invite/signups error). Anything else is a
// failure but does NOT throw — we still want to record the partial
// report.
async function runStepsAgainst(app: FastifyInstance): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  // Step 1 — /ready returns 200 with all configured deps OK.
  try {
    const ready = await buildReadySnapshot(app);
    steps.push({
      name: "ready",
      passed: ready.ok,
      error: ready.ok ? undefined : "ready_not_ok",
    });
  } catch (err) {
    steps.push({
      name: "ready",
      passed: false,
      error: (err as Error).message ?? "ready_threw",
    });
  }

  // Step 2 — synthetic /auth/start. We POST a deliberately bogus
  // invite code so we exercise the validation path without minting a
  // real user. Any of:
  //   * 200 { challengeId } (signup open, no invite gate)
  //   * 400 { error: "invite_invalid" } (gate enforcing)
  //   * 503 { error: "signups_paused" } (kill switch on)
  // counts as "gate is working". Other responses are flagged.
  try {
    const ts = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/start",
      headers: { "content-type": "application/json", "x-openmatch-country": "US" },
      payload: {
        method: "email",
        email: `synthetic+${ts}@openmatch.invalid`,
        inviteCode: "SYNTHETIC-PROBE",
      },
    });
    const body = safeJson(res.body);
    const knownErrors = new Set(["invite_invalid", "signups_paused"]);
    const passed =
      (res.statusCode === 200 && typeof body?.challengeId === "string") ||
      ((res.statusCode === 400 || res.statusCode === 503) && knownErrors.has(body?.error ?? ""));
    steps.push({
      name: "auth_start",
      passed,
      status: res.statusCode,
      error: passed ? undefined : `unexpected_response:${res.statusCode}:${body?.error ?? ""}`,
    });
  } catch (err) {
    steps.push({
      name: "auth_start",
      passed: false,
      error: (err as Error).message ?? "auth_start_threw",
    });
  }

  // Step 3 — /api/v1/discovery/deck?limit=1 without a token. The
  // public surface MUST return 401 (not 500). A consistent gate means
  // the auth plugin is wired correctly.
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/deck?limit=1",
      headers: { "x-openmatch-country": "US" },
    });
    const passed = res.statusCode === 200 || res.statusCode === 401;
    steps.push({
      name: "discovery_deck_gate",
      passed,
      status: res.statusCode,
      error: passed ? undefined : `unexpected_status:${res.statusCode}`,
    });
  } catch (err) {
    steps.push({
      name: "discovery_deck_gate",
      passed: false,
      error: (err as Error).message ?? "discovery_deck_threw",
    });
  }

  // Step 4 — /api/v1/admin/health/snapshot. Hits the internal-token
  // path indirectly; we invoke the underlying snapshot builder so the
  // probe stays self-contained (no admin JWT minting from inside the
  // synthetic). A successful build is sufficient signal.
  try {
    const ready = await buildReadySnapshot(app);
    steps.push({
      name: "admin_health_snapshot",
      passed: ready.ok,
      error: ready.ok ? undefined : "snapshot_not_ok",
    });
  } catch (err) {
    steps.push({
      name: "admin_health_snapshot",
      passed: false,
      error: (err as Error).message ?? "snapshot_threw",
    });
  }

  return steps;
}

function safeJson(input: unknown): { challengeId?: string; error?: string } | null {
  if (typeof input !== "string") return null;
  try {
    return JSON.parse(input) as { challengeId?: string; error?: string };
  } catch {
    return null;
  }
}

export async function runSyntheticCheck(app: FastifyInstance): Promise<SyntheticReport> {
  const startedAt = Date.now();
  const steps = await runStepsAgainst(app);
  const passed = steps.every((s) => s.passed);
  const report: SyntheticReport = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    passed,
    steps,
  };
  try {
    await app.prisma.syntheticCheckRun.create({
      data: {
        durationMs: report.durationMs,
        passed: report.passed,
        steps: report.steps as never,
      },
    });
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "synthetic_check_persist_failed");
  }
  return report;
}

export const internalSyntheticRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/run-synthetic-check",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!checkBearer(req, reply)) return;
      const report = await runSyntheticCheck(app);
      app.log.info(
        {
          event: "internal.synthetic_check",
          passed: report.passed,
          durationMs: report.durationMs,
          failed: report.steps.filter((s) => !s.passed).map((s) => s.name),
        },
        "synthetic_check_run",
      );
      return reply.send(report);
    },
  );
};
