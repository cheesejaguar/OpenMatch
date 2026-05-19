import * as Sentry from "@sentry/node";

// Round D — thin wrapper around `Sentry.startSpan` so hot-path service
// code can opt into tracing without dragging the Sentry import surface
// into every service file. When the Sentry SDK isn't initialised the
// wrapper still invokes the function — the SDK degrades gracefully.

export async function withSpan<T>(
  op: string,
  name: string,
  fn: (span: Sentry.Span | undefined) => Promise<T> | T,
): Promise<T> {
  return Sentry.startSpan({ op, name }, async (span) => fn(span));
}
