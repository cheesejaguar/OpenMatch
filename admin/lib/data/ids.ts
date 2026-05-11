// Lightweight ID helpers for in-memory store. Production swaps for cuid()/uuid.
let counter = 0;
function nextSeq(): string {
  counter += 1;
  return counter.toString(36);
}
export function newId(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${nextSeq()}${r}`;
}
