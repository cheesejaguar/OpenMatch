# OpenMatch Admin Dashboard — PRD reference

This file is a stub pointing to the canonical PRD for the OpenMatch Admin
Dashboard (the internal moderation console deployed on Vercel). The
implementation lives in `admin/` at the repo root and tracks the must-have
scope from §14.1 of the PRD.

The full PRD text is maintained outside the repo (Notion / Drive); this stub
exists so that engineers can find:

- The implementation: `../../admin/`
- Architectural mapping: `admin/README.md`
- Data-model additions awaiting review: `../../backend/prisma/admin.prisma`
- Security baseline: `../../SECURITY.md`

## Quick map: PRD section → code

| PRD section | Where it lives |
| --- | --- |
| §3.2 RBAC catalog | `admin/lib/auth/permissions.ts` |
| §3.3 Access reason capture | `admin/components/AccessReasonForm.tsx` + `admin/lib/actions/access.ts` |
| §4 Workflows | Server actions in `admin/lib/actions/*` and pages in `admin/app/(dashboard)/*` |
| §5 Information architecture | `admin/components/Sidebar.tsx` + `admin/app/(dashboard)/*` |
| §6 Functional requirements | Each `requirePermission(...)` call + `writeAudit(...)` pair |
| §6.9 Audit logging | `admin/lib/audit/log.ts` + `admin/app/(dashboard)/audit/page.tsx` |
| §8 Vercel implementation | `admin/vercel.json`, `admin/next.config.mjs`, `admin/middleware.ts` |
| §9.3 Sensitive access UX | `admin/components/SensitiveBanner.tsx` |
| §16 API contract sketches | Mock implementations in `admin/lib/data/store.ts` |
| §17 Data model additions | `backend/prisma/admin.prisma` (commented; pending review) |
