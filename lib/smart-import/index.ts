import { isConfigured } from "@/lib/ai/client";
import { aiUsage } from "@/lib/ai/run";
import { dbToday } from "@/lib/claims";
import type { Tenant } from "@/lib/db";
import { boardYearOf, yearLabel } from "./dates";
import { PAST_YEARS } from "./shared";

// Smart import, the Sheet Archaeologist (AI feature 3). An optional extra on top of the CSV
// importer (lib/csv.ts), which still checks every row, finds duplicates and imports in one
// transaction. Smart import adds, for a person to accept, edit or drop before anything is written:
// 1. column suggestions from the headers and up to 15 sample rows (Gemini, IMPORT_MAPPING). A
//    header is sent as text only when it is plain spreadsheet words, otherwise as its shape; only
//    the cells of a column headed plainly as the company or the industry are sent as text, and only
//    when they read as a name; every other cell as its shape (columns.ts);
// 2. company names that look alike though the exact checks miss them, "Lilly" and "Eli Lilly"
//    (code) or "CAT" and "Caterpillar" (Gemini, IMPORT_LOOKALIKES, names only), flagged with a
//    reason in the import's duplicate review, never merged (lookalikes.ts, lib/duplicates.ts);
// 3. what the free-text cells say ("emailed 3/2 by Sam, said reach out in Aug"): a stage, a last
//    contacted date, a follow-up date and a contact, each with the quote it came from. These cells
//    can contain names, so they go to Groq (IMPORT_ROWS), never Gemini (owner decision; read.ts),
//    and every reading is checked by code (check.ts, dates.ts).
//
// A long sheet can't be read in one server call, so the browser sends the rows a chunk at a time.
// Each chunk's checked proposals are staged in ImportChunk under an ImportSession (start.ts,
// read.ts); companies are only written by the final import, in one transaction, which uses the
// session once and deletes it (commit.ts). A session is ignored after 24 hours and removed the next
// time the same person starts another.

export { cellShape, cleanSuggestion, sampleSheet, shownColumns, suggestColumns, type ColumnSuggestion } from "./columns";
export { checkRowsRead, findDoNotContact, quoteInCell, type Quote, type RowProposal, type RowsReadOutput } from "./check";
export { runSmartImport } from "./commit";
export { boardYearOf, parseDateText, resolveDate, yearLabel } from "./dates";
export { type LookalikeGroup } from "./lookalikes";
export { readSmartChunk, type SmartChunk, type SmartChunkResult } from "./read";
export { startSmartRead, type SmartStart } from "./start";

export type SmartOptions = { aiOn: boolean; gemini: boolean; groq: boolean; cycles: { start: number; label: string }[]; current: number };

// What the import page needs to show the Smart import switch: AI off hides it.
export async function smartOptions(tenant: Tenant): Promise<SmartOptions> {
  const [usage, today] = await Promise.all([aiUsage(tenant), dbToday()]);
  const current = boardYearOf(today);
  const cycles = Array.from({ length: PAST_YEARS + 1 }, (_, i) => ({ start: current - i, label: yearLabel(current - i) }));
  return { aiOn: usage.enabled, gemini: isConfigured(), groq: isConfigured("groq"), cycles, current };
}
