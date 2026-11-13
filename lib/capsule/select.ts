import type { Stage } from "@/generated/prisma/enums";
import { CARD_AI_COMPANIES, CARD_COMPANIES_PER_CALL } from "./limits";

// Which companies get a relationship card, and in what order (pure; tests/capsule-select.test.ts).
// Selection is by code: companies that are not archived and have at least one outreach in the
// board year. They are ordered by stage, then by how much outreach they got, so the first 60 (the
// ones the model reads, four to a call) are the deals worth the most to hand on. The rest get cards
// made by code alone.

// Committed first; a company back at Not contacted (reopened) comes last.
export const CARD_STAGE_ORDER: Stage[] = ["COMMITTED", "IN_CONVERSATION", "REPLIED", "CONTACTED", "DECLINED", "NOT_CONTACTED"];
const rank = new Map(CARD_STAGE_ORDER.map((stage, i) => [stage, i]));

export type SelectionRow = { id: string; name: string; stage: Stage; outreachCount: number };

// Stage in the order above, then more outreach first, then name and id so ties are always the same.
export function selectCompanies(rows: readonly SelectionRow[]): SelectionRow[] {
  return [...rows].sort(
    (a, b) =>
      (rank.get(a.stage) ?? CARD_STAGE_ORDER.length) - (rank.get(b.stage) ?? CARD_STAGE_ORDER.length) ||
      b.outreachCount - a.outreachCount ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

// The ids the model reads, in groups of four, and the ids that get code-only cards.
export function planReading(ids: readonly string[]): { chunks: string[][]; codeOnly: string[] } {
  const read = ids.slice(0, CARD_AI_COMPANIES);
  const chunks: string[][] = [];
  for (let i = 0; i < read.length; i += CARD_COMPANIES_PER_CALL) chunks.push(read.slice(i, i + CARD_COMPANIES_PER_CALL));
  return { chunks, codeOnly: ids.slice(CARD_AI_COMPANIES) };
}
