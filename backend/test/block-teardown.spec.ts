import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// SEV-M11 — Block enforcement tears down the Ably channel for any
// closed match's conversation.
//
// `blockUser` runs against the real Postgres test database so the
// Block upsert and the CTE-wrapped UPDATE ... RETURNING that closes
// matches are exercised for real. Only the Ably REST client — a paid
// third-party realtime service — is replaced, so we can observe the
// teardown publishes without a network call. Everything else in
// `lib/realtime.ts` (e.g. the channel-name builder) is the real code.

const { channelGet } = vi.hoisted(() => ({ channelGet: vi.fn() }));
vi.mock("../src/lib/realtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/realtime.js")>();
  return { ...actual, ably: { channels: { get: channelGet } } };
});

import { blockUser } from "../src/services/safety.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

async function makeActiveMatch(x: string, y: string, withConversation = true) {
  const [userAId, userBId] = [x, y].sort() as [string, string];
  const match = await testPrisma.match.create({
    data: { userAId, userBId, status: "active" },
  });
  const conversation = withConversation
    ? await testPrisma.conversation.create({ data: { matchId: match.id, status: "active" } })
    : null;
  return { match, conversation };
}

describe("blockUser — SEV-M11 channel teardown", () => {
  let publish: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    channelGet.mockReset();
    publish = vi.fn();
    channelGet.mockReturnValue({ publish });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("rejects self-block without writing a Block row", async () => {
    const alice = await createUser();
    await expect(blockUser(testPrisma, alice.id, alice.id)).rejects.toMatchObject({
      message: "cannot_block_self",
      statusCode: 400,
    });
    expect(await testPrisma.block.count()).toBe(0);
  });

  it("upserts the Block row and unmatches the active match", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const { match } = await makeActiveMatch(alice.id, bob.id);

    await blockUser(testPrisma, alice.id, bob.id);

    const blocks = await testPrisma.block.findMany();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ blockerUserId: alice.id, blockedUserId: bob.id });

    const closed = await testPrisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(closed.status).toBe("unmatched");
    expect(closed.unmatchedByUserId).toBe(alice.id);
    expect(closed.unmatchedAt).toBeInstanceOf(Date);

    // Blocking twice is idempotent: still a single Block row.
    await blockUser(testPrisma, alice.id, bob.id);
    expect(await testPrisma.block.count()).toBe(1);
  });

  it("leaves matches between other users untouched", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const { match: aliceCarol } = await makeActiveMatch(alice.id, carol.id);
    await makeActiveMatch(alice.id, bob.id);

    await blockUser(testPrisma, alice.id, bob.id);

    const untouched = await testPrisma.match.findUniqueOrThrow({ where: { id: aliceCarol.id } });
    expect(untouched.status).toBe("active");
    expect(untouched.unmatchedAt).toBeNull();
  });

  it("publishes a `conversation.closed` event on the closed match's channel", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const { conversation } = await makeActiveMatch(bob.id, alice.id);

    await blockUser(testPrisma, alice.id, bob.id);

    expect(channelGet).toHaveBeenCalledTimes(1);
    expect(channelGet).toHaveBeenCalledWith(`conversation:${conversation!.id}`);
    expect(publish).toHaveBeenCalledTimes(1);
    const [event, payload] = publish.mock.calls[0]!;
    expect(event).toBe("conversation.closed");
    expect(payload).toMatchObject({ conversationId: conversation!.id, reason: "blocked" });
    expect(Number.isNaN(Date.parse(payload.at))).toBe(false);
  });

  it("does not publish when the closed match has no conversation", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const { match } = await makeActiveMatch(alice.id, bob.id, false);

    await blockUser(testPrisma, alice.id, bob.id);

    expect((await testPrisma.match.findUniqueOrThrow({ where: { id: match.id } })).status).toBe(
      "unmatched",
    );
    expect(channelGet).not.toHaveBeenCalled();
  });

  it("does not publish when there are no active matches", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await blockUser(testPrisma, alice.id, bob.id);
    expect(channelGet).not.toHaveBeenCalled();
  });

  it("swallows Ably publish failures so the block still lands", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await makeActiveMatch(alice.id, bob.id);
    publish.mockRejectedValueOnce(new Error("ably down"));

    await expect(blockUser(testPrisma, alice.id, bob.id)).resolves.toBeUndefined();
    expect(await testPrisma.block.count()).toBe(1);
  });
});
