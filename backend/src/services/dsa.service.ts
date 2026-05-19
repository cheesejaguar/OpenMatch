import type { NoticeAndActionCategory, NoticeAndActionStatus, PrismaClient } from "@prisma/client";

// DSA Art. 16 SLA windows. Acknowledgement within 24h, decision within
// 48h — those numbers are the column defaults; the existing per-category
// `slaDueAt` legacy field continues to track the response-time targets
// (CSAM 24h / NCII 48h / other 7d).
const DSA_ACK_SLA_HOURS = 24;
const DSA_DECISION_SLA_HOURS = 48;

// DSA notice-and-action intake (Art. 16) + statement-of-reasons (Art. 17).
//
// Unlike `Report` (user-to-user in-app), this surface is open to any
// person, including non-users. The category vocabulary is the statutory
// one so the resulting statement-of-reasons maps cleanly into the EC
// Transparency Database.
//
// SLA windows used as defaults (counsel review pending):
//   - CSAM:    24 hours (industry norm; precedes statutory)
//   - NCII:    48 hours (TAKE IT DOWN Act §1309)
//   - Other illegal content: 7 days (DSA — "without undue delay")

function defaultSlaHours(category: NoticeAndActionCategory): number {
  switch (category) {
    case "csam":
      return 24;
    case "ncii":
      return 48;
    case "copyright_dmca":
      return 7 * 24;
    case "terrorism_violent":
      return 24;
    case "underage":
      return 24;
    default:
      return 7 * 24;
  }
}

export interface OpenNoticeInput {
  category: NoticeAndActionCategory;
  reporterIsUser: boolean;
  reporterUserId?: string | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
  reporterCountry?: string | null;
  reporterIsTrustedFlagger?: boolean;
  trustedFlaggerId?: string | null;
  affectedUserId?: string | null;
  contentReference: string;
  contentSnapshot?: unknown;
  description: string;
  isInGoodFaith: boolean;
  jurisdictionClaim?: string | null;
  legalBasisClaim?: string | null;
}

export async function openNotice(prisma: PrismaClient, input: OpenNoticeInput) {
  const now = new Date();
  const slaDueAt = new Date(now.getTime() + defaultSlaHours(input.category) * 3600 * 1000);
  // SAFE-4: every notice carries an ack + decision deadline. These are
  // independent of the per-category `slaDueAt`: they encode the DSA
  // procedural promise (acknowledge fast, decide soon after) rather
  // than the content-specific takedown target.
  const slaAckDueAt = new Date(now.getTime() + DSA_ACK_SLA_HOURS * 3600 * 1000);
  const slaDecisionDueAt = new Date(now.getTime() + DSA_DECISION_SLA_HOURS * 3600 * 1000);
  return prisma.noticeAndActionReport.create({
    data: {
      category: input.category,
      status: "received",
      reporterIsUser: input.reporterIsUser,
      reporterUserId: input.reporterUserId ?? null,
      reporterName: input.reporterName ?? null,
      reporterEmail: input.reporterEmail ?? null,
      reporterCountry: input.reporterCountry ?? null,
      reporterIsTrustedFlagger: input.reporterIsTrustedFlagger ?? false,
      trustedFlaggerId: input.trustedFlaggerId ?? null,
      affectedUserId: input.affectedUserId ?? null,
      contentReference: input.contentReference,
      contentSnapshot: input.contentSnapshot as never,
      description: input.description,
      isInGoodFaith: input.isInGoodFaith,
      jurisdictionClaim: input.jurisdictionClaim ?? null,
      legalBasisClaim: input.legalBasisClaim ?? null,
      slaDueAt,
      slaAckDueAt,
      slaDecisionDueAt,
    },
  });
}

// Mark a notice as acknowledged. Distinct from `decideNotice`:
// acknowledgement is "we've seen this and are working on it" and stops
// the 24h ack-SLA clock; decision is the substantive ruling.
export async function acknowledgeNotice(
  prisma: PrismaClient,
  id: string,
  adminUserId?: string | null,
) {
  return prisma.noticeAndActionReport.update({
    where: { id },
    data: {
      status: "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedByAdminUserId: adminUserId ?? null,
    },
  });
}

export type NoticeDecision = "actioned" | "rejected" | "withdrawn";

export async function decideNotice(
  prisma: PrismaClient,
  id: string,
  adminUserId: string,
  decision: NoticeDecision,
) {
  const now = new Date();
  const existing = await prisma.noticeAndActionReport.findUnique({
    where: { id },
    select: { acknowledgedAt: true },
  });
  return prisma.noticeAndActionReport.update({
    where: { id },
    data: {
      status: decision,
      // If the ack hadn't been recorded yet (operator skipped straight
      // to a decision), fill it now so the SLA-breach worker doesn't
      // also flag the ack window.
      acknowledgedAt: existing?.acknowledgedAt ?? now,
      respondedAt: now,
      resolvedAt: now,
      decidedByAdminUserId: adminUserId,
    },
  });
}

export async function listOpenNotices(
  prisma: PrismaClient,
  args: { status?: NoticeAndActionStatus } = {},
) {
  return prisma.noticeAndActionReport.findMany({
    where: args.status ? { status: args.status } : undefined,
    orderBy: { slaDueAt: "asc" },
    take: 200,
  });
}

export interface CreateStatementOfReasonsInput {
  affectedUserId?: string | null;
  affectedContentReference: string;
  restrictionType:
    | "content_removed"
    | "visibility_restriction"
    | "account_suspension"
    | "account_termination"
    | "monetary"
    | "service_termination";
  facts: string;
  legalGround?: "illegal_content" | "tos_violation";
  legalGroundReference?: string;
  contractualGround?: string;
  contentType?: string;
  contentLanguage?: string;
  decisionSource:
    | "user_report"
    | "trusted_flagger"
    | "authority_order"
    | "automated_detection"
    | "internal";
  automatedDecision?: boolean;
  redress?: { internal?: boolean; outOfCourt?: boolean; judicial?: boolean };
}

export async function createStatementOfReasons(
  prisma: PrismaClient,
  input: CreateStatementOfReasonsInput,
) {
  return prisma.dsaStatementOfReasons.create({
    data: {
      affectedUserId: input.affectedUserId ?? null,
      affectedContentReference: input.affectedContentReference,
      restrictionType: input.restrictionType,
      facts: input.facts,
      legalGround: input.legalGround ?? null,
      legalGroundReference: input.legalGroundReference ?? null,
      contractualGround: input.contractualGround ?? null,
      contentType: input.contentType ?? null,
      contentLanguage: input.contentLanguage ?? null,
      decisionSource: input.decisionSource,
      automatedDecision: input.automatedDecision ?? false,
      redressInternal: input.redress?.internal ?? true,
      redressOutOfCourt: input.redress?.outOfCourt ?? true,
      redressJudicial: input.redress?.judicial ?? true,
    },
  });
}
