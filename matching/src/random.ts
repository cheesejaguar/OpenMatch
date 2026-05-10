import seedrandom from "seedrandom";

// Deterministic per (viewer, candidate, algorithm version, day).
// Reproducible across runs so synthetic tests stay stable.
export function dailyRandom(
  viewerId: string,
  candidateId: string,
  algorithmVersion: string,
  date: Date,
): number {
  const dayKey = date.toISOString().slice(0, 10);
  const seed = `${viewerId}|${candidateId}|${algorithmVersion}|${dayKey}`;
  const rng = seedrandom(seed);
  return rng();
}
