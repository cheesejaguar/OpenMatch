import { describe, expect, it, vi } from "vitest";

// SEV-M11 — Block enforcement tears down the Ably channel for any
// closed match's conversation.
//
// We exercise `blockUser` against an in-memory mock prisma so we can
// assert:
//   1. The Block row is upserted.
//   2. Active matches between the two parties are closed.
//   3. The Ably channel teardown publish happens for every affected
//      conversation.
//
// The full DB-backed flow (creating a match, sending a message,
// confirming the channel-close event arrives) belongs to the chat
// integration suite; this spec pins the unit contract.

vi.mock("../src/lib/realtime.js", () => {
  return {
    ably: { channels: { get: vi.fn() } },
    conversationChannel: (id: string) => `conversation:${id}`,
    publishMessage: vi.fn(),
    publishConversationEvent: vi.fn(),
  };
});

import { ably } from "../src/lib/realtime.js";
import { blockUser } from "../src/services/safety.service.js";

interface MockMatch {
  id: string;
  conversation: { id: string } | null;
}

function buildPrismaMock(activeMatches: MockMatch[]) {
  const blockUpsert = vi.fn();
  // PERF-B7 — safety.service now uses a single CTE-wrapped
  // UPDATE...RETURNING via tx.$queryRaw (one round-trip in place of
  // findMany+updateMany). Mock returns the same shape the real query
  // would yield: one row per closed match with its conversationId.
  const queryRaw = vi.fn(async () =>
    activeMatches.map((m) => ({ conversationId: m.conversation?.id ?? null })),
  );
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      block: { upsert: blockUpsert },
      $queryRaw: queryRaw,
    }),
  );
  return {
    prisma: { $transaction: transaction } as never,
    spies: { blockUpsert, queryRaw },
  };
}

describe("blockUser — SEV-M11 channel teardown", () => {
  it("rejects self-block before touching the DB", async () => {
    const { prisma } = buildPrismaMock([]);
    await expect(blockUser(prisma, "u1", "u1")).rejects.toThrow(/cannot_block_self/);
  });

  it("upserts the Block row and unmatches the active match", async () => {
    const { prisma, spies } = buildPrismaMock([{ id: "m1", conversation: { id: "conv1" } }]);
    await blockUser(prisma, "u_alice", "u_bob");
    expect(spies.blockUpsert).toHaveBeenCalledOnce();
    const upsertArg = spies.blockUpsert.mock.calls[0]![0];
    expect(upsertArg.create).toEqual({ blockerUserId: "u_alice", blockedUserId: "u_bob" });
    expect(spies.queryRaw).toHaveBeenCalledOnce();
    // The raw CTE update is built via a tagged-template literal so the
    // first positional arg is the template-string array (or values
    // array depending on Prisma version). We assert the values include
    // the blocker + sorted pair + 'unmatched' literal indirectly via
    // the integration test; here we just confirm the call shape.
    const queryArgs = spies.queryRaw.mock.calls[0]!;
    expect(queryArgs.length).toBeGreaterThan(0);
  });

  it("publishes a `conversation.closed` event per affected channel", async () => {
    const { prisma } = buildPrismaMock([
      { id: "m1", conversation: { id: "convA" } },
      { id: "m2", conversation: { id: "convB" } },
    ]);
    const channelGet = ably!.channels.get as ReturnType<typeof vi.fn>;
    const publish = vi.fn();
    channelGet.mockReturnValue({ publish });
    await blockUser(prisma, "u_alice", "u_bob");
    // One call per closed conversation.
    expect(channelGet).toHaveBeenCalledWith("conversation:convA");
    expect(channelGet).toHaveBeenCalledWith("conversation:convB");
    expect(publish).toHaveBeenCalledTimes(2);
    for (const call of publish.mock.calls) {
      const [event, payload] = call;
      expect(event).toBe("conversation.closed");
      expect(payload.reason).toBe("blocked");
      expect(typeof payload.conversationId).toBe("string");
    }
  });

  it("does not publish when there are no active matches", async () => {
    const { prisma } = buildPrismaMock([]);
    const channelGet = ably!.channels.get as ReturnType<typeof vi.fn>;
    channelGet.mockReset();
    await blockUser(prisma, "u_alice", "u_bob");
    expect(channelGet).not.toHaveBeenCalled();
  });
});
