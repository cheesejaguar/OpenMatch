// Shared SLA helpers for moderator queues. The convention until DSA's
// stricter per-notice deadlines land is: 4 hours for any open queue
// item. "Approaching" = ≥ 75 % of window elapsed. "Breached" = past
// the deadline.

export type SlaState = "within" | "approaching" | "breached";

export const DEFAULT_SLA_HOURS = 4;

export function formatAge(fromIso: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(fromIso).getTime());
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMin = mins % 60;
    return remMin > 0 ? `${hours} h ${remMin} m` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} d ${remHours} h` : `${days} d`;
}

export function slaState(
  fromIso: string,
  budgetHours: number = DEFAULT_SLA_HOURS,
  now: Date = new Date(),
): SlaState {
  const elapsedMs = now.getTime() - new Date(fromIso).getTime();
  const budgetMs = budgetHours * 60 * 60 * 1000;
  if (elapsedMs >= budgetMs) return "breached";
  if (elapsedMs >= budgetMs * 0.75) return "approaching";
  return "within";
}

export function slaBadgeClass(state: SlaState): string {
  switch (state) {
    case "within":
      return "badge sla-within";
    case "approaching":
      return "badge sla-approaching";
    case "breached":
      return "badge sla-breached";
  }
}

export function slaLabel(state: SlaState): string {
  switch (state) {
    case "within":
      return "Within";
    case "approaching":
      return "Approaching";
    case "breached":
      return "Breached";
  }
}
