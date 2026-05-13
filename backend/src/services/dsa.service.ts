import type { NoticeAndActionCategory, NoticeAndActionStatus, PrismaClient } from "@prisma/client";

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
  const slaDueAt = new Date(Date.now() + defaultSlaHours(input.category) * 3600 * 1000);
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
    },
  });
}

export async function acknowledgeNotice(prisma: PrismaClient, id: string) {
  return prisma.noticeAndActionReport.update({
    where: { id },
    data: { status: "acknowledged", acknowledgedAt: new Date() },
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
