import type { PrismaClient } from "@prisma/client";
import { withSpan } from "../lib/spans.js";
import { reportUser } from "./safety.service.js";

// Post-match outcome loop (#1) + two-sided post-date feedback (#11).
// Private, never shown to the other person. Two consumers:
//   - safety: respectful=false / matchedProfile=false feed the existing
//     report/moderation pipeline as a trust signal.
//   - matching: met/wantToContinue aggregates inform desirability and
//     response-quality (read in discovery.service hydration).

// Matches younger than this aren't prompted for "did you meet?" yet.
const FEEDBACK_ELIGIBLE_AFTER_DAYS = 3;

export interface SubmitDateFeedbackInput {
  prisma: PrismaClient;
  matchId: string;
  fromUserId: string;
  met: boolean;
  wantToContinue?: boolean;
  respectful?: boolean;
  matchedProfile?: boolean;
  note?: string;
}

export async function submitDateFeedback(input: SubmitDateFeedbackInput) {
  return withSpan("dateFeedback.submit", "dateFeedback.submit", async () => {
    const match = await input.prisma.match.findUnique({ where: { id: input.matchId } });
    if (!match) throw Object.assign(new Error("match_not_found"), { statusCode: 404 });
    if (match.userAId !== input.fromUserId && match.userBId !== input.fromUserId) {
      throw Object.assign(new Error("not_participant"), { statusCode: 403 });
    }
    const aboutUserId = match.userAId === input.fromUserId ? match.userBId : match.userAId;

    const row = await input.prisma.dateFeedback.upsert({
      where: {
        matchId_fromUserId: { matchId: input.matchId, fromUserId: input.fromUserId },
      },
      create: {
        matchId: input.matchId,
        fromUserId: input.fromUserId,
        aboutUserId,
        met: input.met,
        wantToContinue: input.wantToContinue ?? null,
        respectful: input.respectful ?? null,
        matchedProfile: input.matchedProfile ?? null,
        note: input.note ?? null,
      },
      update: {
        met: input.met,
        wantToContinue: input.wantToContinue ?? null,
        respectful: input.respectful ?? null,
        matchedProfile: input.matchedProfile ?? null,
        note: input.note ?? null,
      },
    });

    // Safety hook (#11): negative trust signals flow into the moderation
    // pipeline as a report from the person who experienced it.
    if (input.respectful === false) {
      await reportUser(
        input.prisma,
        input.fromUserId,
        aboutUserId,
        "other",
        "Post-date feedback: reported as not respectful.",
      );
    } else if (input.matchedProfile === false) {
      await reportUser(
        input.prisma,
        input.fromUserId,
        aboutUserId,
        "fake_profile",
        "Post-date feedback: did not match their profile.",
      );
    }

    return row;
  });
}

// Matches the viewer should be prompted to give feedback on: active, the
// viewer is a participant, the match has matured, and they haven't already
// given feedback. Powers the iOS "how did it go?" prompt (#1).
export async function listPendingDateFeedback(prisma: PrismaClient, userId: string) {
  const cutoff = new Date(Date.now() - FEEDBACK_ELIGIBLE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const matches = await prisma.match.findMany({
    where: {
      status: "active",
      createdAt: { lt: cutoff },
      OR: [{ userAId: userId }, { userBId: userId }],
      dateFeedbacks: { none: { fromUserId: userId } },
    },
    select: { id: true, userAId: true, userBId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return matches.map((m) => ({
    matchId: m.id,
    aboutUserId: m.userAId === userId ? m.userBId : m.userAId,
    matchedAt: m.createdAt,
  }));
}
