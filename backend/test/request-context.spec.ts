import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { requestContext } from "../src/lib/request-context.js";

// Round D — AsyncLocalStorage-backed request context.
//
// Coverage:
//   - the Pino mixin reads requestId / userId / adminUserId from the
//     active store on every log line
//   - workerRun spawns a fresh request id when there is no active store
//   - workerRun inherits the parent request id when nested inside one
//   - two concurrent workerRun frames don't bleed their ids into each
//     other (the whole point of AsyncLocalStorage)

function captureLogger(): { logger: pino.Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString("utf8").trim();
      for (const part of text.split("\n").filter(Boolean)) {
        try {
          lines.push(JSON.parse(part));
        } catch {
          // ignore non-JSON noise
        }
      }
      cb();
    },
  });
  const logger = pino(
    {
      level: "info",
      mixin() {
        const ctx = requestContext.get();
        if (!ctx) return {};
        return {
          requestId: ctx.requestId,
          ...(ctx.userId ? { userId: ctx.userId } : {}),
          ...(ctx.adminUserId ? { adminUserId: ctx.adminUserId } : {}),
        };
      },
    },
    sink,
  );
  return { logger, lines };
}

describe("requestContext", () => {
  it("Pino mixin tags every log line with the active request id", async () => {
    const { logger, lines } = captureLogger();
    await requestContext.run({ requestId: "req-1" }, async () => {
      logger.info("hello");
      requestContext.set({ userId: "u_42" });
      logger.info("after-user");
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.requestId).toBe("req-1");
    expect(lines[0]?.userId).toBeUndefined();
    expect(lines[1]?.requestId).toBe("req-1");
    expect(lines[1]?.userId).toBe("u_42");
  });

  it("workerRun spawns a fresh worker-prefixed id outside of a request", async () => {
    let captured: string | undefined;
    await requestContext.workerRun("deletion", async () => {
      captured = requestContext.get()?.requestId;
    });
    expect(captured).toMatch(/^worker\.deletion\./);
  });

  it("workerRun inherits the parent request id when nested", async () => {
    let captured: string | undefined;
    await requestContext.run({ requestId: "req-parent" }, async () => {
      await requestContext.workerRun("deletion", async () => {
        captured = requestContext.get()?.requestId;
      });
    });
    expect(captured).toBe("req-parent");
  });

  it("concurrent workerRun frames don't bleed request ids", async () => {
    const idsSeen: string[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        requestContext.workerRun(`task-${i}`, async () => {
          // Force a tick so the scheduler interleaves the frames.
          await new Promise((r) => setImmediate(r));
          const id = requestContext.get()?.requestId;
          if (id) idsSeen.push(id);
        }),
      ),
    );
    // Each frame gets a unique id and the prefix matches its label.
    expect(new Set(idsSeen).size).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(idsSeen.some((id) => id.startsWith(`worker.task-${i}.`))).toBe(true);
    }
  });
});
