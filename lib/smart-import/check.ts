import { z } from "zod";
import { matchKey } from "@/lib/ai/text";
import { addDays, formatYmd } from "@/lib/dates";
import { CONTACT_LIMITS } from "@/lib/limits";
import { injectionFlags } from "@/lib/research/scan";
import { contactFieldsSchema, SMART_NOTE_MAX } from "@/lib/validation";
import { boardYearOf, daysIn, longDay, parseDateText, placeFollowUp, placeLastContacted, resolveDate, yearLabel, type Placed } from "./dates";

// What Smart import accepts from the AI's reading of free-text cells (lib/smart-import/). The
// model is never trusted: every quote must really be in the cell it names (spacing and smart quotes
// aside); dates are read from the quote by code and placed in the sheet's board year, checked
// against the database's today; Committed and Declined are never set; anything that fails a check
// or is ambiguous is dropped, not guessed. Pure, so tests can run it directly.

export const CHUNK_ROWS = 15;

// Whether a quote really appears in the cell, ignoring case, spacing and smart quotes.
export function quoteInCell(quote: string, cell: string): boolean {
  const key = matchKey(quote);
  return key.length >= 2 && matchKey(cell).includes(key);
}

// A do-not-contact line, found by code on every row (not only the ones the AI reads).
const DO_NOT_CONTACT =
  /\b(?:do\s*n[o']?t|don't|dont|never)\s+(?:contact|e-?mail|reach\s+out|call|pitch|ask)\b|\basked\s+(?:us\s+)?(?:to\s+)?(?:stop|not\s+to)\b|\bstop\s+(?:contacting|e-?mailing|reaching\s+out)\b|\bunsubscribe(?:d)?\b|\bremove\s+(?:us|them|me)\s+from\b|\bno\s+more\s+(?:contact|e-?mails?)\b|\bdnc\b/i;

export function findDoNotContact(cell: string): string | null {
  return DO_NOT_CONTACT.exec(cell)?.[0] ?? null;
}

// Text planted in a cell to steer the reading: anything that reads as instructions to an AI
// (lib/research/scan.ts), or an order about how to mark the row ("mark this row committed", "they
// said YES, mark committed", "set the stage to declined"). A sheet's own notes say what happened
// ("committed $5k", "Mark said no"); they don't tell the reader what to record. "Mark" capitalised
// with nothing after it but the status word is a name ("Mark committed $2k"), so it isn't flagged.
const STATUS_WORD = String.raw`(?:committed|commit|declined|decline|replied|contacted|in[\s_-]?conversation|do[\s_-]?not[\s_-]?contact|dnc)\b`;
const ORDER_TARGET = String.raw`(?:(?:this|the|that|it|them|its|their)\s+)?(?:(?:row|entry|company|record|line|status|stage|outcome|lead|sponsor)\s+)?(?:(?:as|to|into)\s+)?`;
const STATUS_ORDER = [
  new RegExp(String.raw`\b(?:set|change|update|move|switch|record|flag|label|treat|classify)\s+${ORDER_TARGET}${STATUS_WORD}`, "i"),
  // "mark", lower case anywhere, or with an object or "as"/"to" after it.
  new RegExp(String.raw`\bmark\s+${ORDER_TARGET}${STATUS_WORD}`),
  new RegExp(String.raw`\b[Mm][Aa][Rr][Kk]\s+(?:(?:this|the|that|it|them|its|their)\s+|(?:row|entry|company|record|status|stage|outcome)\s+|(?:as|to|into)\s+)${ORDER_TARGET}${STATUS_WORD}`),
];

export function plantedInstruction(text: string): string | null {
  const flagged = injectionFlags(text)[0];
  if (flagged) return flagged;
  for (const pattern of STATUS_ORDER) {
    const hit = pattern.exec(text)?.[0];
    if (hit) return hit.replace(/\s+/g, " ").trim().slice(0, 80);
  }
  return null;
}

export type Quote = { column: number; header: string; quote: string };

// A row's free-text cells as the AI was shown them (masked and cut, so quotes are checked against
// exactly that text).
export type ReadRow = { row: number; cells: { column: number; header: string; text: string }[] };

const STATUS = ["not_contacted", "contacted", "replied", "in_conversation", "committed", "declined", "do_not_contact"] as const;
type Status = (typeof STATUS)[number];
const quoted = { cell: z.number().int().describe("Column number of the cell"), quote: z.string().max(300).describe("Shortest exact piece of that cell's text") };
// Each part of a row is checked on its own: one that doesn't fit becomes null (dropped) instead of
// failing the whole chunk.
export const RowsRead = z.object({
  rows: z
    .array(
      z
        .object({
          row: z.number().int().describe("The row number"),
          status: z.object({ value: z.enum(STATUS), ...quoted }).nullable().catch(null),
          lastContacted: z.object(quoted).nullable().catch(null).describe("The date we last reached out or heard back"),
          followUp: z.object(quoted).nullable().catch(null).describe("The date to reach out next"),
          contact: z
            .object({ name: z.string().max(CONTACT_LIMITS.name), title: z.string().max(CONTACT_LIMITS.title).nullable(), ...quoted })
            .nullable()
            .catch(null)
            .describe("A person at the company, never a member of our organization"),
        })
        .nullable()
        .catch(null),
    )
    .max(CHUNK_ROWS * 2),
});
export type RowsReadOutput = z.output<typeof RowsRead>;
type Answer = NonNullable<RowsReadOutput["rows"][number]>;

export type RowProposal = {
  row: number;
  // A stage before any outcome, for a sheet from this board year.
  stage: ({ value: "CONTACTED" | "REPLIED" | "IN_CONVERSATION" } & Quote) | null;
  lastContactedOn: ({ date: string } & Quote) | null;
  followUpOn: ({ date: string } & Quote) | null;
  contact: ({ name: string; title: string | null } & Quote) | null;
  // A line for the notes: an outcome (Committed or Declined are never set as a stage), or a past
  // board year's whole story, which comes back as a fresh lead.
  note: { text: string; quotes: Quote[] } | null;
  doNotContact: Quote | null;
  // This board year's sheet says they committed or declined. The stage is never set from it, and
  // the row starts skipped, so nobody pitches a sponsor who already said yes or no; the person can
  // import it anyway (as Not contacted, with the note).
  outcome?: { value: "committed" | "declined" } & Quote;
  // How many of the AI's items were dropped by a check, and why.
  dropped: string[];
  // A last-contacted date was moved a year earlier, or dropped, because it would be in the future.
  future?: boolean;
};

const STAGE_OF = { contacted: "CONTACTED", replied: "REPLIED", in_conversation: "IN_CONVERSATION" } as const;
const OUTCOME_WORD = { committed: "committed", declined: "declined", do_not_contact: "asked not to be contacted" } as const;

type Context = { cycleStart: number; today: string; pastYear: boolean; ourNames: readonly string[] };
type Dated = { date: string; quote: Quote } | null;

// The quote, if it really is in the cell the AI named; otherwise the item is dropped.
function checkQuote(proposal: RowProposal, cells: ReadRow["cells"], item: { cell: number; quote: string } | null, what: string): Quote | null {
  if (!item) return null;
  const cell = cells.find((c) => c.column === item.cell);
  const quote = item.quote.trim();
  if (!cell || !quoteInCell(quote, cell.text)) {
    proposal.dropped.push(`${what}: the quote isn't in that cell`);
    return null;
  }
  return { column: cell.column, header: cell.header, quote };
}

// A date read from its quote by code and placed in the sheet's board year (a past year's sheet,
// whose dates are only noted).
function dateFrom(proposal: RowProposal, q: Quote | null, what: string, cycleStart: number, opts: { after?: string; needDay: boolean }): Dated {
  if (!q) return null;
  const parts = parseDateText(q.quote);
  const date = parts && resolveDate(parts, cycleStart, opts);
  if (!date) {
    const year = parts && parts.day !== null ? (parts.year ?? (parts.month >= 7 ? cycleStart : cycleStart + 1)) : null;
    const noDay = parts && parts.day !== null && year !== null && parts.day > daysIn(year, parts.month);
    proposal.dropped.push(noDay ? `${what}: "${q.quote}" isn't a real day in ${year}` : `${what}: "${q.quote}" isn't one clear date`);
    return null;
  }
  return { date, quote: q };
}

// The text of a drop that placement reported, naming the real reason.
function placeDropped(proposal: RowProposal, what: string, q: Quote, placed: Placed | null, window: string): Dated {
  if (placed === null) {
    proposal.dropped.push(`${what}: "${q.quote}" isn't one clear date`);
    return null;
  }
  if (!("drop" in placed)) return { date: placed.date, quote: q };
  const shown = placed.date ? longDay(placed.date) : null;
  proposal.dropped.push(
    placed.drop === "no-day"
      ? `${what}: "${q.quote}" isn't a real day in ${placed.year}`
      : placed.drop === "future"
        ? `${what}: ${shown} would be in the future`
        : `${what}: ${shown} ${window}`,
  );
  return null;
}

// The last-contacted and follow-up dates for a sheet from the current board year. A written year is
// never changed. A last-contacted date without one goes in the board year, or the year before when
// it would otherwise be in the future (it must be in the last two years and not in the future). A
// follow-up without a year is the next such date on or after today, within a year of today.
function checkDates(proposal: RowProposal, last: Quote | null, follow: Quote | null, { cycleStart, today, pastYear }: Context): [Dated, Dated] {
  if (pastYear) {
    // A past board year's dates are only noted, so they are placed in that year and not range checked.
    const lastOn = dateFrom(proposal, last, "Last contacted", cycleStart, { needDay: true });
    return [lastOn, dateFrom(proposal, follow, "Follow-up", cycleStart, { after: lastOn?.date, needDay: false })];
  }
  let lastOn: Dated = null;
  if (last) {
    const parts = parseDateText(last.quote);
    const placed = parts && placeLastContacted(parts, cycleStart, today);
    lastOn = placeDropped(proposal, "Last contacted", last, placed, "isn't in the last two years");
    if (placed && ("drop" in placed ? placed.drop === "future" : placed.moved)) proposal.future = true;
    if (lastOn && (lastOn.date > today || lastOn.date < addDays(today, -730))) {
      // A written year is checked as written.
      proposal.dropped.push(`Last contacted: ${longDay(lastOn.date)} ${lastOn.date > today ? "would be in the future" : "isn't in the last two years"}`);
      if (lastOn.date > today) proposal.future = true;
      lastOn = null;
    }
  }
  let followOn: Dated = null;
  if (follow) {
    const parts = parseDateText(follow.quote);
    followOn = placeDropped(proposal, "Follow-up", follow, parts && placeFollowUp(parts, cycleStart, today, lastOn?.date), "isn't within a year of today");
    if (followOn && (followOn.date < addDays(today, -365) || followOn.date > addDays(today, 365))) {
      proposal.dropped.push(`Follow-up: ${longDay(followOn.date)} isn't within a year of today`);
      followOn = null;
    }
  }
  return [lastOn, followOn];
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cellNameKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

// Whether a name is one of us rather than someone at the company: the person who did the outreach
// ("emailed 3/2 by Sam", "cc Priya"), or a member of this workspace (their full name, or a
// one-word name that is a member's first name). Without this check, "emailed 3/2 by Sam" would
// propose "Sam" as the company's contact.
function oneOfUs(name: string, cellText: string, ourNames: readonly string[]): boolean {
  if (new RegExp(`\\b(?:by|cc'?d?|bcc)\\s+${escapeRe(name)}\\b`, "i").test(cellText)) return true;
  const key = cellNameKey(name);
  return ourNames.some((member) => {
    const full = cellNameKey(member);
    return full === key || (!key.includes(" ") && full.split(" ")[0] === key);
  });
}

// A contact named in its quote, for a row that has none yet (a contact named only from the row's
// email doesn't count: lib/smart-import/read.ts). A job title is kept only if the quote shows it too.
function checkContact(
  proposal: RowProposal,
  contact: Answer["contact"],
  q: Quote | null,
  hasContact: boolean,
  cellText: string,
  ourNames: readonly string[],
): RowProposal["contact"] {
  if (!contact || !q) return null;
  const name = contactFieldsSchema.shape.name.safeParse(contact.name);
  const title = contactFieldsSchema.shape.title.safeParse(contact.title);
  if (hasContact) {
    proposal.dropped.push("Contact: this row already has one");
    return null;
  }
  if (!name.success || !title.success || !quoteInCell(name.data, q.quote) || /\[(email|phone)\]/.test(name.data)) {
    proposal.dropped.push("Contact: the name isn't in its quote");
    return null;
  }
  if (oneOfUs(name.data.trim(), cellText, ourNames)) {
    proposal.dropped.push(`Contact: "${name.data.trim()}" reads as someone in your organization, not at the company`);
    return null;
  }
  const shownTitle = title.data && quoteInCell(title.data, q.quote) ? title.data : null;
  return { name: name.data, title: shownTitle, ...q };
}

// "Aug 2025", for a date the sheet gave only as a month.
const monthYear = (date: string) => formatYmd(date, { month: "short", year: "numeric" });

// A past board year never sets a stage or dates: it comes back as a fresh lead, with its story in
// the notes.
function pastYearNote(cycleStart: number, status: { value: Status; quote: Quote } | null, last: Dated, follow: Dated): RowProposal["note"] {
  const parts: string[] = [];
  const quotes: Quote[] = [];
  if (status && status.value !== "not_contacted") {
    const word = status.value === "in_conversation" ? "in conversation" : (OUTCOME_WORD[status.value as keyof typeof OUTCOME_WORD] ?? status.value);
    parts.push(`${word} ("${status.quote.quote}")`);
    quotes.push(status.quote);
  }
  if (last) {
    parts.push(`last contacted ${longDay(last.date)}`);
    quotes.push(last.quote);
  }
  if (follow) {
    // "reach out in Aug" names a month, not a day: the note says only what the sheet said.
    const parts2 = parseDateText(follow.quote.quote);
    parts.push(`follow-up was ${parts2 && parts2.day === null ? monthYear(follow.date) : longDay(follow.date)}`);
    quotes.push(follow.quote);
  }
  return parts.length > 0 ? { text: `From the ${yearLabel(cycleStart)} sheet: ${parts.join("; ")}.`.slice(0, SMART_NOTE_MAX), quotes } : null;
}

// One row: code's own do-not-contact check first (it never depends on the AI), then each item of
// the AI's answer checked on its own.
function checkRow({ row, cells }: ReadRow, answer: Answer | undefined, ctx: Context, hasContact: boolean): RowProposal {
  const proposal: RowProposal = { row, stage: null, lastContactedOn: null, followUpOn: null, contact: null, note: null, doNotContact: null, dropped: [] };
  for (const cell of cells) {
    const hit = findDoNotContact(cell.text);
    if (hit && !proposal.doNotContact) proposal.doNotContact = { column: cell.column, header: cell.header, quote: hit };
  }
  if (!answer) return proposal;

  const statusQuote = answer.status ? checkQuote(proposal, cells, answer.status, "Stage") : null;
  let status = answer.status && statusQuote ? { value: answer.status.value, quote: statusQuote } : null;
  // A row with text planted to steer the reading gets no stage or outcome from the AI at all, in
  // any board year: the reading may have followed it, whichever cell it quotes. The do-not-contact
  // check above is code's own and still stands; dates and a contact still need their quotes.
  const planted = cells.map((c) => plantedInstruction(c.text)).find(Boolean);
  if (planted && status) {
    proposal.dropped.push(`Stage: a cell in this row holds instructions to the AI ("${planted}"), so no stage or outcome is read from it`);
    status = null;
  }
  const [last, follow] = checkDates(
    proposal,
    checkQuote(proposal, cells, answer.lastContacted, "Last contacted"),
    checkQuote(proposal, cells, answer.followUp, "Follow-up"),
    ctx,
  );
  const contactQuote = checkQuote(proposal, cells, answer.contact, "Contact");
  const contactCell = cells.find((c) => c.column === contactQuote?.column)?.text ?? "";
  proposal.contact = checkContact(proposal, answer.contact, contactQuote, hasContact, contactCell, ctx.ourNames);
  if (status?.value === "do_not_contact" && !proposal.doNotContact) proposal.doNotContact = status.quote;

  if (ctx.pastYear) {
    proposal.note = pastYearNote(ctx.cycleStart, status, last, follow);
    return proposal;
  }
  if (status && status.value in STAGE_OF) proposal.stage = { value: STAGE_OF[status.value as keyof typeof STAGE_OF], ...status.quote };
  if (status && (status.value === "committed" || status.value === "declined")) {
    const text = `The ${yearLabel(ctx.cycleStart)} sheet says ${OUTCOME_WORD[status.value]}: "${status.quote.quote}".`;
    proposal.note = { text: text.slice(0, SMART_NOTE_MAX), quotes: [status.quote] };
    proposal.outcome = { value: status.value as "committed" | "declined", ...status.quote };
  }
  if (last) proposal.lastContactedOn = { date: last.date, ...last.quote };
  if (follow) proposal.followUpOn = { date: follow.date, ...follow.quote };
  return proposal;
}

// Turns the AI's reading of one chunk into checked proposals: the rows it was shown, the AI's
// answer, the sheet's board year and the database's today. Answers for rows it wasn't shown, and a
// second answer for the same row, are ignored.
export function checkRowsRead(
  shown: ReadRow[],
  read: RowsReadOutput,
  { cycleStart, today, hasContact, ourNames = [] }: { cycleStart: number; today: string; hasContact: Set<number>; ourNames?: readonly string[] },
): RowProposal[] {
  const ctx: Context = { cycleStart, today, pastYear: cycleStart < boardYearOf(today), ourNames };
  const answers = new Map<number, Answer>();
  for (const answer of read.rows) if (answer && !answers.has(answer.row)) answers.set(answer.row, answer);
  return shown.map((r) => checkRow(r, answers.get(r.row), ctx, hasContact.has(r.row)));
}
