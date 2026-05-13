import type { PrismaClient } from "@prisma/client";

// NCMEC CyberTipline reporting pipeline (18 U.S.C. §2258A).
//
// We are a "provider of an electronic communication service" once the
// Service is operational, which means we have:
//   1. A statutory duty to report apparent CSAM to NCMEC's CyberTipline.
//   2. A 90-day preservation obligation for the reported content under
//      §2258A(h).
//   3. A duty to NOT report what isn't CSAM, and to keep reports
//      confidential except as the statute permits.
//
// This module is the *intake side*: it creates a pending NcmecReport
// row whenever the safety pipeline determines an apparent CSAM hash
// match. The outbound submission to the CyberTipline (POSTs an XML/JSON
// envelope to NCMEC's APIs) requires registration with NCMEC and a
// signed agreement; until that lands the submission worker stays in
// "pending" status and a moderator manually files via NCMEC's web form.
//
// docs/legal/vendor-register.md tracks the registration status.

export interface QueueNcmecReportArgs {
  triggerHashSignalId?: string;
  affectedUserId?: string;
  contentReference: string;
  /** Sanitised payload — never include the raw bytes here; only the
   *  identifiers and metadata. The image itself is preserved separately
   *  per §2258A(h). */
  payload: Record<string, unknown>;
}

const PRESERVATION_DAYS = 90;

export async function queueNcmecReport(prisma: PrismaClient, args: QueueNcmecReportArgs) {
  const preservationEndsAt = new Date(Date.now() + PRESERVATION_DAYS * 24 * 3600 * 1000);
  return prisma.ncmecReport.create({
    data: {
      triggerHashSignalId: args.triggerHashSignalId ?? null,
      affectedUserId: args.affectedUserId ?? null,
      contentReference: args.contentReference,
      payload: args.payload as never,
      preservationEndsAt,
      status: "pending",
    },
  });
}

export async function markNcmecReportSubmitted(
  prisma: PrismaClient,
  id: string,
  cybertiplineId: string,
) {
  return prisma.ncmecReport.update({
    where: { id },
    data: {
      status: "submitted",
      submittedAt: new Date(),
      cybertiplineId,
    },
  });
}

export async function markNcmecReportFailed(
  prisma: PrismaClient,
  id: string,
  errorMessage: string,
) {
  return prisma.ncmecReport.update({
    where: { id },
    data: { status: "failed", errorMessage },
  });
}

export async function listPendingNcmecReports(prisma: PrismaClient) {
  return prisma.ncmecReport.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}
