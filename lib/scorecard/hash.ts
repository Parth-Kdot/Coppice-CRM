import { createHash } from "node:crypto";
import type { Fact } from "@/lib/scorecard/facts";

// A short fingerprint of the fact table's keys and values (not the label texts), so the stats page
// can tell when the numbers an explanation was written about are no longer today's numbers. The
// facts are sorted by key first, so the order they were built in never changes the hash.
export function factsHash(facts: readonly Pick<Fact, "key" | "value">[]): string {
  const entries = facts.map((f) => [f.key, f.value] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 32);
}
