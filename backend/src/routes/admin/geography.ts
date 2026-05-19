import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

// ADMIN-3 — geographic insights.
//
// We don't ship a zip-code lookup table in v0 (it'd add ~30 MB to the
// deployment and is overkill for one US metro). Instead, group active
// users into 0.05° latitude/longitude bins (~5 km in the SF metro)
// and report counts per bin. The admin UI can render a choropleth /
// table off this.
//
// Match density: count of active matches where BOTH participants
// fall in the same bin. We use the userA side as the bin owner so
// each match is counted once.
//
// Cohort filtering is by `?metro=` (slug from MetroBoundary). Without
// it we use the first active metro.

const BUCKET_DEGREES = 0.05;

const querySchema = z.object({
  metro: z.string().min(1).max(60).optional(),
});

export const adminGeographyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.METRICS_READ));

  app.get("/", async (req, reply) => {
    const q = querySchema.parse(req.query);
    const metro = q.metro
      ? await app.prisma.metroBoundary.findUnique({ where: { slug: q.metro } })
      : await app.prisma.metroBoundary.findFirst({
          where: { active: true },
          orderBy: { createdAt: "asc" },
        });
    if (!metro) {
      return reply.send({ metro: null, buckets: [] });
    }

    // Pull all in-metro user locations. We rely on PostGIS ST_DWithin
    // for the geo-fence and round to BUCKET_DEGREES on the way out.
    // `Profile.location` is `geography(Point, 4326)`, so distances are
    // metres.
    type LatLng = { user_id: string; lat: number; lng: number };
    const radiusMeters = metro.radiusKm * 1000;
    const rows = await app.prisma.$queryRawUnsafe<LatLng[]>(
      `SELECT p."userId" AS user_id,
              ST_Y(p."location"::geometry) AS lat,
              ST_X(p."location"::geometry) AS lng
       FROM "Profile" p
       JOIN "User" u ON u."id" = p."userId"
       WHERE p."location" IS NOT NULL
         AND p."visibilityStatus" = 'visible'
         AND u."status" = 'active'
         AND ST_DWithin(
           p."location",
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )`,
      metro.centerLng,
      metro.centerLat,
      radiusMeters,
    );

    // Bin users.
    type BinAgg = { users: Set<string>; sumLat: number; sumLng: number };
    const bins = new Map<string, BinAgg>();
    function binKey(lat: number, lng: number): string {
      const bLat = Math.floor(lat / BUCKET_DEGREES) * BUCKET_DEGREES;
      const bLng = Math.floor(lng / BUCKET_DEGREES) * BUCKET_DEGREES;
      return `${bLat.toFixed(2)},${bLng.toFixed(2)}`;
    }
    const userBin = new Map<string, string>();
    for (const r of rows) {
      const key = binKey(r.lat, r.lng);
      userBin.set(r.user_id, key);
      let agg = bins.get(key);
      if (!agg) {
        agg = { users: new Set(), sumLat: 0, sumLng: 0 };
        bins.set(key, agg);
      }
      agg.users.add(r.user_id);
      agg.sumLat += r.lat;
      agg.sumLng += r.lng;
    }

    // Count matches whose participants share a bin. We only consider
    // matches whose userA falls inside the metro; the userB filter is
    // applied via the bin lookup.
    const matchRows = await app.prisma.match.findMany({
      where: { status: "active" },
      select: { userAId: true, userBId: true },
    });
    const binMatches = new Map<string, number>();
    for (const m of matchRows) {
      const aBin = userBin.get(m.userAId);
      const bBin = userBin.get(m.userBId);
      if (!aBin || aBin !== bBin) continue;
      binMatches.set(aBin, (binMatches.get(aBin) ?? 0) + 1);
    }

    const buckets = Array.from(bins.entries())
      .map(([key, agg]) => {
        const count = agg.users.size;
        return {
          label: key,
          lat: count > 0 ? agg.sumLat / count : 0,
          lng: count > 0 ? agg.sumLng / count : 0,
          userCount: count,
          matchCount: binMatches.get(key) ?? 0,
        };
      })
      .sort((a, b) => b.userCount - a.userCount);

    return reply.send({
      metro: { slug: metro.slug, name: metro.name },
      bucketDegrees: BUCKET_DEGREES,
      buckets,
    });
  });
};
