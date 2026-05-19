import type { PrismaClient } from "@prisma/client";

// DSA Art. 16 SLA breach detector (SAFE-4).
//
// Notices have two deadlines tracked in NoticeAndActionReport:
//   - slaAckDueAt:      24h to first acknowledge a notice
//   - slaDecisionDueAt: 48h to issue a decision
//
// This worker is cron-scheduled (`vercel.json` runs it hourly) and marks
// notices that crossed either deadline without the corresponding
// timestamp being filled. Each breach also writes an admin audit row so
// the admin "Health" panel and weekly DSA digest can count breaches.

export interface DsaSlaReport {
  scannedAt: string;
  ackBreached: number;
  decisionBreached: number;
  durationMs: number;
}

export async function runDsaSlaCheckOnce(prisma: PrismaClient): Promise<DsaSlaReport> {
  const startedAt = Date.now();
  const scannedAt = new Date();

  // Acknowledgement breach: deadline passed and acknowledgedAt is still
  // null AND we haven't already recorded the breach.
  const ackCandidates = await prisma.noticeAndActionReport.findMany({
    where: {
      slaAckDueAt: { lt: scannedAt, not: null },
      acknowledgedAt: null,
      slaAckBreachedAt: null,
    },
    select: { id: true, category: true, slaAckDueAt: true },
  });
  for (const row of ackCandidates) {
    await prisma.noticeAndActionReport.update({
      where: { id: row.id },
      data: { slaAckBreachedAt: scannedAt },
    });
  }

  // Decision breach: deadline passed and respondedAt still null.
  const decisionCandidates = await prisma.noticeAndActionReport.findMany({
    where: {
      slaDecisionDueAt: { lt: scannedAt, not: null },
      respondedAt: null,
      slaDecisionBreachedAt: null,
    },
    select: { id: true, category: true, slaDecisionDueAt: true },
  });
  for (const row of decisionCandidates) {
    await prisma.noticeAndActionReport.update({
      where: { id: row.id },
      data: { slaDecisionBreachedAt: scannedAt },
    });
  }

  // Audit rows — one per breach, attributed to the system admin if
  // present. The breach event is `dsa_sla_breach` with metadata
  // distinguishing ack vs decision.
  const systemAdmin = await prisma.adminUser.findUnique({
    where: { email: "system@openmatch.local" },
    select: { id: true },
  });
  if (systemAdmin) {
    const rows = [
      ...ackCandidates.map((c) => ({
        id: c.id,
        kind: "ack",
        category: c.category,
        deadline: c.slaAckDueAt,
      })),
      ...decisionCandidates.map((c) => ({
        id: c.id,
        kind: "decision",
        category: c.category,
        deadline: c.slaDecisionDueAt,
      })),
    ];
    for (const r of rows) {
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: systemAdmin.id,
          adminRoleSnapshot: "system",
          eventType: "dsa_sla_breach",
          targetEntityType: "dsa_notice",
          targetEntityId: r.id,
          metadata: {
            kind: r.kind,
            category: r.category,
            deadline: r.deadline?.toISOString() ?? null,
            source: "dsa-sla-worker",
          },
        },
      });
    }
  }

  return {
    scannedAt: scannedAt.toISOString(),
    ackBreached: ackCandidates.length,
    decisionBreached: decisionCandidates.length,
    durationMs: Date.now() - startedAt,
  };
}
