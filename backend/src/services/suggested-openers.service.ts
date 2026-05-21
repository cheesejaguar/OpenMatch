import type { PrismaClient } from "@prisma/client";
import { authorizedForConversation } from "./chat.service.js";

// DISC-Q2 — conversation-starter suggestions.
//
// When two users match, iOS drops them into an empty chat. We surface
// three "suggested opener" pills above the text input so the viewer has
// a starting point that isn't a blank cursor.
//
// Strategy (intentionally template-y for v1):
//   1. Pull the OTHER party's `Profile.prompts` (already a `[{question,
//      answer}]` JSON array).
//   2. Rank prompts by `answer.length` descending — a longer answer is
//      a richer hook to riff on.
//   3. Template each into a referential opener that quotes the answer
//      verbatim and tees up a follow-up question. We keep three
//      templates so two consecutive matches don't see identical text.
//   4. If the other party has fewer than 3 prompts, top up with warm
//      generic openers.
//
// The endpoint contract — `GET /conversations/:id/suggested-openers ->
// { openers: [{ text, sourcePromptQuestion? }] }` — is the load-bearing
// part. A fork can swap the implementation for an LLM call behind the
// same surface area without an iOS change.

export interface SuggestedOpener {
  text: string;
  sourcePromptQuestion?: string;
}

// Single quote escape — answers go inside an outer "…" pair in the
// templated string. Strip CRLF so multi-line answers don't break the
// chip layout on iOS.
function sanitizeAnswer(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
}

// Mirror the prompt JSON shape stored on Profile.prompts. We don't
// import the Zod schema from the profile route to keep this service
// self-contained (the route validates on write, so reads can trust the
// shape).
interface PromptRow {
  question: string;
  answer: string;
}

function isPromptRow(v: unknown): v is PromptRow {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { question?: unknown }).question === "string" &&
    typeof (v as { answer?: unknown }).answer === "string" &&
    (v as { question: string }).question.length > 0 &&
    (v as { answer: string }).answer.length > 0
  );
}

// The three templated forms. Index `i` is taken modulo the array
// length when there are more than 3 prompts to choose from.
const TEMPLATE_FORMS: ((sanitizedAnswer: string, question: string) => string)[] = [
  (answer) => `Hey! I noticed you said "${answer}" — what got you into that?`,
  (answer, question) =>
    `Hi! Your answer to "${question}" caught my eye ("${answer}"). Tell me more?`,
  (answer) => `"${answer}" — same energy. What else are you into right now?`,
];

// Generic openers when the other party has fewer than 3 prompts. Tone
// is intentionally warm-but-low-stakes; nothing that demands a specific
// reply. Ordered so the *first* generic is the most universally safe.
const GENERIC_OPENERS: string[] = [
  "Hi, hope you had a good week!",
  "Hey, what are you up to today?",
  "Hi — happy we matched. What's been the highlight of your week?",
];

/**
 * Build up to 3 suggested openers for a given conversation, scoped to
 * the viewer ("me") talking to the OTHER party. Returns null when the
 * viewer is not a participant in the conversation.
 */
export async function buildSuggestedOpeners(
  prisma: PrismaClient,
  conversationId: string,
  viewerUserId: string,
): Promise<{ openers: SuggestedOpener[] } | null> {
  // Authz reuses the same predicate as chat read/write. A non-participant
  // gets a null return which the route translates to 404 so we don't
  // disclose conversation existence.
  if (!(await authorizedForConversation(prisma, conversationId, viewerUserId))) {
    return null;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { match: { select: { userAId: true, userBId: true } } },
  });
  if (!conversation) return null;

  const otherUserId =
    conversation.match.userAId === viewerUserId
      ? conversation.match.userBId
      : conversation.match.userAId;

  const otherProfile = await prisma.profile.findUnique({
    where: { userId: otherUserId },
    select: { prompts: true, updatedAt: true },
  });

  const rawPrompts = otherProfile?.prompts;
  const prompts: PromptRow[] = Array.isArray(rawPrompts)
    ? (rawPrompts as unknown[]).filter(isPromptRow)
    : [];

  // Rank prompts by answer length DESC. We don't have per-prompt
  // updatedAt (the whole prompts array shares one column) so "longest
  // answer" is the best stand-in for "the prompt this person put the
  // most thought into".
  const ranked = [...prompts].sort((a, b) => b.answer.length - a.answer.length);

  const openers: SuggestedOpener[] = [];
  for (let i = 0; i < ranked.length && openers.length < 3; i++) {
    const p = ranked[i]!;
    const formatter = TEMPLATE_FORMS[openers.length % TEMPLATE_FORMS.length]!;
    openers.push({
      text: formatter(sanitizeAnswer(p.answer), p.question),
      sourcePromptQuestion: p.question,
    });
  }

  // Top up with generics if we couldn't fill from prompts.
  for (let i = 0; openers.length < 3 && i < GENERIC_OPENERS.length; i++) {
    openers.push({ text: GENERIC_OPENERS[i]! });
  }

  return { openers };
}
