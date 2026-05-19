import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";
import { ERROR_CODE_META, type ErrorCode, ErrorCodes } from "./error-codes.js";

// Shape every API error response in this codebase MUST conform to.
// `error` is the stable machine-readable code from ErrorCodes.
// `message` is optional human-readable detail; never the source of truth.
// Routes may attach extra well-known fields (e.g. `required` for RBAC,
// `nearestKm` for metro gates) by passing `details` to httpError.
export interface HttpErrorBody {
  error: string;
  message?: string;
  fields?: Array<{ path: string; message: string; code?: string }>;
  // Permit additional well-known fields without forcing every caller to
  // widen the type. Keep payload surfaces small.
  [k: string]: unknown;
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: ErrorCode;
  readonly body: HttpErrorBody;

  constructor(statusCode: number, errorCode: ErrorCode, body: HttpErrorBody) {
    super(body.message ?? errorCode);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.body = body;
  }
}

export interface HttpErrorOpts {
  status?: number;
  message?: string;
  // Extra fields merged into the response body (e.g. `reason`,
  // `required`, `nearestKm`). Avoid `error` / `message` keys here —
  // those are managed by the helper.
  details?: Record<string, unknown>;
}

// Build an HttpError using the canonical (code → status) mapping. Routes
// can override `status` per call but should only do so when the meta
// entry's default is genuinely wrong for the context.
export function httpError(errorCode: ErrorCode, opts: HttpErrorOpts = {}): HttpError {
  const meta = ERROR_CODE_META[errorCode];
  const status = opts.status ?? meta.status;
  const body: HttpErrorBody = {
    error: errorCode,
    ...(opts.message ? { message: opts.message } : {}),
    ...(opts.details ?? {}),
  };
  return new HttpError(status, errorCode, body);
}

// Convenience for `return sendHttpError(reply, httpError(...))` — keeps
// the call site's `return` expression and lets Fastify infer void.
export function sendHttpError(reply: FastifyReply, err: HttpError) {
  return reply.code(err.statusCode).send(err.body);
}

// Translate a thrown ZodError into the canonical validation_failed
// response. Each issue becomes a `fields[]` entry with a stable shape.
export function zodErrorToHttp(err: ZodError): HttpError {
  return httpError(ErrorCodes.VALIDATION_FAILED, {
    details: {
      fields: err.issues.map((i) => ({
        path: i.path.map((p) => String(p)).join("."),
        message: i.message,
        code: i.code,
      })),
    },
  });
}
