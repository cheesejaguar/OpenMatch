type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-accent-soft text-accent",
};

const map: Record<string, { label: string; tone: Tone }> = {
  active: { label: "active", tone: "ok" },
  paused: { label: "paused", tone: "neutral" },
  banned: { label: "banned", tone: "danger" },
  suspended: { label: "suspended", tone: "warn" },
  deleted: { label: "deleted", tone: "neutral" },
  visible: { label: "visible", tone: "ok" },
  hidden: { label: "hidden", tone: "neutral" },
  clean: { label: "clean", tone: "ok" },
  reviewed_ok: { label: "reviewed", tone: "ok" },
  under_review: { label: "under review", tone: "warn" },
  restricted: { label: "restricted", tone: "warn" },
  removed: { label: "removed", tone: "danger" },
  verified: { label: "verified", tone: "ok" },
  pending: { label: "pending", tone: "warn" },
  unverified: { label: "unverified", tone: "neutral" },
  open: { label: "open", tone: "warn" },
  reviewing: { label: "reviewing", tone: "info" },
  resolved: { label: "resolved", tone: "ok" },
  dismissed: { label: "dismissed", tone: "neutral" },
  escalated: { label: "escalated", tone: "danger" },
  low: { label: "low", tone: "neutral" },
  medium: { label: "medium", tone: "info" },
  high: { label: "high", tone: "warn" },
  critical: { label: "critical", tone: "danger" },
  lifted: { label: "lifted", tone: "neutral" },
};

export function StatusBadge({ value }: { value: string }) {
  const e = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <span className={`badge ${toneClass[e.tone]}`}>{e.label}</span>;
}
