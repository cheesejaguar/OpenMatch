import Ably from "ably";
import { env } from "../env.js";

// Ably is OpenMatch's managed realtime fan-out for chat. The REST client is
// used server-side to publish messages and mint capability-scoped tokens
// for the iOS client to subscribe with.
//
// When ABLY_API_KEY is unset (local dev), we expose a null client and
// callers must no-op publish to keep the API working without realtime.

type GlobalWithAbly = typeof globalThis & { __omAbly?: Ably.Rest | null };
const g = globalThis as GlobalWithAbly;

function buildClient(): Ably.Rest | null {
  if (!env.ABLY_API_KEY) return null;
  return new Ably.Rest({ key: env.ABLY_API_KEY });
}

if (g.__omAbly === undefined) {
  g.__omAbly = buildClient();
}
export const ably: Ably.Rest | null = g.__omAbly;

export function conversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export async function publishMessage(conversationId: string, payload: unknown): Promise<void> {
  if (!ably) return;
  try {
    await ably.channels.get(conversationChannel(conversationId)).publish("message", payload);
  } catch {
    // Realtime fan-out is best-effort; the message is already persisted in
    // the DB and clients will fetch it on reconnect / next poll.
  }
}
