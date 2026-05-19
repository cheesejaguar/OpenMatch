import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError } from "../lib/http-error.js";
import { runPushRetryOnce } from "../services/push.service.js";
import { runAlertCheckOnce } from "../workers/alerter.js";
import { runDailyDigestOnce } from "../workers/daily-digest.js";
import { runDeletionPurgeOnce } from "../workers/deletion.js";
import { runDsaSlaCheckOnce } from "../workers/dsa-sla.js";

// Internal cron-style endpoints invoked by Vercel cron (and by ops
// runbooks). Authorisation is a single shared secret in the
// `Authorization: Bearer <INTERNAL_WORKER_TOKEN>` header — distinct
// from the consumer JWT (`Authorization` interpreted by `app.authenticate`)
// and the admin JWT, so a compromised user / admin token can't trigger
// these.
//
// Rate-limited modestly to prevent log noise from a misconfigured cron
// hitting us in a tight loop.

function checkBearer(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    const err = httpError(ErrorCodes.UNAUTHORIZED);
    void reply.code(err.statusCode).send(err.body);
    return false;
  }
  const token = header.slice("Bearer ".length).trim();
  // Constant-time-ish compare. The default value of INTERNAL_WORKER_TOKEN
  // is deliberately long enough that timing-attack delta is negligible
  // against a real production secret. We still avoid a vanilla `===`
  // on raw strings via a length check + char-by-char xor.
  if (!constantTimeEqual(token, env.INTERNAL_WORKER_TOKEN)) {
    const err = httpError(ErrorCodes.UNAUTHORIZED);
    void reply.code(err.statusCode).send(err.body);
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

export const internalRoutes: FastifyPluginAsync = async (app) => {
  // Both routes share the same rate-limit: 5/min per IP. The cron is
  // hourly / quarter-hourly so this is plenty of headroom; an ops
  // runbook running on a laptop won't hit it either.
  const rateLimit = { max: 5, timeWindow: "1 minute" } as const;

  app.post("/run-deletion-purge", { config: { rateLimit } }, async (req, reply) => {
    if (!checkBearer(req, reply)) return;
    const report = await runDeletionPurgeOnce(app.prisma);
    app.log.info(
      {
        event: "internal.deletion_purge",
        purged: report.purged,
        errors: report.errors,
        durationMs: report.durationMs,
      },
      "deletion_purge_run",
    );
    return reply.send(report);
  });

  app.post("/run-dsa-sla-check", { config: { rateLimit } }, async (req, reply) => {
    if (!checkBearer(req, reply)) return;
    const report = await runDsaSlaCheckOnce(app.prisma);
    app.log.info(
      {
        event: "internal.dsa_sla_check",
        ackBreached: report.ackBreached,
        decisionBreached: report.decisionBreached,
        durationMs: report.durationMs,
      },
      "dsa_sla_check_run",
    );
    return reply.send(report);
  });

  // OPS-1: APNs delivery retry. Picks up the last 60s of failures and
  // gives them one more attempt.
  app.post("/run-push-retry", { config: { rateLimit } }, async (req, reply) => {
    if (!checkBearer(req, reply)) return;
    const report = await runPushRetryOnce(app.prisma);
    app.log.info(
      {
        event: "internal.push_retry",
        retried: report.retried,
        succeeded: report.succeeded,
        failed: report.failed,
        durationMs: report.durationMs,
      },
      "push_retry_run",
    );
    return reply.send(report);
  });

  // MON-1: daily success digest. Builds the snapshot and (when SMTP is
  // configured) emails the admin allowlist.
  app.post("/run-daily-digest", { config: { rateLimit } }, async (req, reply) => {
    if (!checkBearer(req, reply)) return;
    const report = await runDailyDigestOnce(app.prisma);
    app.log.info(
      {
        event: "internal.daily_digest",
        emailed: report.emailed,
        recipients: report.recipients,
        durationMs: report.durationMs,
      },
      "daily_digest_run",
    );
    return reply.send(report);
  });

  // MON-2: on-call alerter. Evaluates the alert conditions and posts
  // any newly-firing ones to Slack (when SLACK_WEBHOOK_URL is set).
  app.post("/run-alert-check", { config: { rateLimit } }, async (req, reply) => {
    if (!checkBearer(req, reply)) return;
    const report = await runAlertCheckOnce(app.prisma);
    app.log.info(
      {
        event: "internal.alert_check",
        fired: report.fired,
        suppressed: report.suppressed,
        durationMs: report.durationMs,
      },
      "alert_check_run",
    );
    return reply.send(report);
  });
};
