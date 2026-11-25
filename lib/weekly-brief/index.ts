import { z } from "zod";
import type { Membership } from "@/lib/authz";
import { isConfigured } from "@/lib/ai/client";
import { AI_ERROR_MESSAGES, aiGate, runAi, type AiRunError } from "@/lib/ai/run";
import { dbNow, dbToday, heldBy } from "@/lib/claims";
import { addDays, day, localMidnight, TIME_ZONE } from "@/lib/dates";
import { withTenant } from "@/lib/db";
import { acceptNarrative, filterNarrative, resolveParagraphs, STORED_MAX_PARAGRAPHS, STORED_MAX_SEGMENTS, type NarrativeParagraph } from "@/lib/scorecard/explain";
import type { FactTable } from "@/lib/scorecard/facts";
import { TERMINAL_STAGES } from "@/lib/stages";
import { weeklyBriefReplySchema } from "@/lib/validation";
import { countFacts, isQuiet, readWeeklyCounts, verdictFacts, weeklyLines, type WeeklyCounts } from "@/lib/weekly-brief/facts";
import { WEEKLY_SYSTEM, weeklyPrompt } from "@/lib/weekly-brief/prompt";
import { isOpenByDefault, weekRanges, weekStartOf } from "@/lib/weekly-brief/week";
import { workspaceRow } from "@/lib/workspaces";

// The Monday brief (Ask Coppice, AI feature 6). Once per workspace per week, the first time anyone
// opens the queue, the browser asks a small route (app/api/workspaces/[workspaceId]/weekly-brief)
// to write it, so the queue's own actions never wait behind the model. Code counts the week
// (facts.ts), one Groq call writes words around the counts' keys, and the reply is checked exactly
// as "Explain these numbers" checks its own (filterNarrative). Every number on the card is a chip
// drawn from the stored facts. Under it, each person sees a live line of their own claims that end
// this week, read fresh on every load and never sent to a model. AI proposes nothing here and
// changes nothing but this one row.

// The short codes a FAILED row keeps (the migration's CHECK lists the same ones).
export const WEEKLY_ERROR_CODES = [
  "rate_limited",
  "timeout",
  "unavailable",
  "truncated",
  "invalid_output",
  "broke_rules",
  "bad_key",
  "blocked",
  "rejected",
  "not_configured",
  "refused",
] as const;
export type WeeklyErrorCode = (typeof WEEKLY_ERROR_CODES)[number];

// The failures that can clear on their own. Nobody waits on this call, so unlike a click it is
// tried again after a 429 (owner decision, Nov 24): 15 minutes apart, at most 3 tries a week. A bad
// key, a blocked or refused request, or a server with no key won't change by waiting.
export const RETRYABLE_CODES: readonly WeeklyErrorCode[] = ["rate_limited", "timeout", "unavailable", "truncated", "invalid_output", "broke_rules", "refused"];
export const MAX_ATTEMPTS = 3;
export const RETRY_WAIT_MS = 15 * 60 * 1000;
// A WRITING row older than this was left by a writer that never finished (a crash, a closed
// function): the next view takes it over. The call itself times out after 30 seconds.
export const WRITING_STALE_MS = 2 * 60 * 1000;
// Weeks kept; older rows are deleted when a new week's row is written.
export const KEEP_WEEKS = 8;
export const MINE_SHOWN = 5;

// runAi says what went wrong as a sentence; these messages turn each sentence back into its code.
// Any other sentence came from the gate inside runAi (the limit changed since aiGate ran): refused.
const PREFIX = "weekly:";
const MESSAGES = Object.fromEntries([...Object.keys(AI_ERROR_MESSAGES), "broke_rules"].map((code) => [code, `${PREFIX}${code}`])) as Partial<Record<AiRunError, string>>;
export function codeOfError(message: string): WeeklyErrorCode {
  const code = message.startsWith(PREFIX) ? message.slice(PREFIX.length) : "refused";
  return (WEEKLY_ERROR_CODES as readonly string[]).includes(code) ? (code as WeeklyErrorCode) : "refused";
}

// ----- What is stored -----

const storedCounts = z.object({
  weekStart: z.string(),
  last: z.object({
    outreach: z.number(),
    companies: z.number(),
    members: z.number(),
    answers: z.number(),
    committed: z.number(),
    declined: z.number(),
    added: z.number(),
  }),
  prev: z.object({ outreach: z.number() }),
  now: z.object({
    overdue: z.number(),
    dueThisWeek: z.number(),
    claimsEnding: z.number(),
    liveClaims: z.number(),
    freshLeads: z.number(),
    open: z.number(),
  }),
});
const storedFacts = z.object({
  counts: storedCounts,
  facts: z.array(z.object({ key: z.string(), value: z.union([z.number(), z.string()]), text: z.string(), what: z.string() })),
  names: z.record(z.string(), z.string()),
});
// A quiet week stores no paragraphs, so unlike the stats page's explanation an empty list is allowed.
const storedParagraphs = z
  .array(z.object({ segments: z.array(z.object({ text: z.string().nullable(), fact: z.string().nullable() })).min(1).max(STORED_MAX_SEGMENTS) }))
  .max(STORED_MAX_PARAGRAPHS);

// ----- What the card shows -----

// "ready": the stored brief (its paragraphs may be empty: a quiet week).
// "writing": someone's view started it under 2 minutes ago.
// "missing": nothing written yet this week, or a try that can be made again now. Only here does the
//   browser ask the route to write it.
// "code-only": the code lines alone, because Groq isn't set up, the limit is close, or the week's
//   tries can't be made again (yet or at all).
export type WeeklyBriefState = "ready" | "writing" | "missing" | "code-only";
export type MyClaimEnding = { id: string; name: string; until: string };
export type WeeklyBriefView = {
  weekStart: string;
  // "Week of Nov 23"
  weekLabel: string;
  state: WeeklyBriefState;
  paragraphs: NarrativeParagraph[];
  dropped: number;
  // The numbers as plain sentences by code.
  lines: string[];
  // "Mon, Nov 23, 9:14 AM", for a stored brief.
  writtenAt: string | null;
  mine: { rows: MyClaimEnding[]; count: number };
  openByDefault: boolean;
};

const writtenText = (date: Date) =>
  date.toLocaleString("en-US", { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type Clock = { now: Date; today: string };
const readClock = async (clock?: Clock): Promise<Clock> => clock ?? { now: await dbNow(), today: await dbToday() };

type Row = { status: "WRITING" | "READY" | "FAILED"; error: string | null; attempts: number; startedAt: Date };
const isStale = (row: Row, now: Date) => row.status === "WRITING" && now.getTime() - row.startedAt.getTime() >= WRITING_STALE_MS;
const canRetry = (row: Row) => row.status === "FAILED" && row.attempts < MAX_ATTEMPTS && (RETRYABLE_CODES as readonly string[]).includes(row.error ?? "");
const waitedEnough = (row: Row, now: Date) => now.getTime() - row.startedAt.getTime() >= RETRY_WAIT_MS;
// Whether this view may try (again) now: a stale row left by a writer that never finished, or a
// retryable failure past its wait, while tries are left this week.
const mayTakeOver = (row: Row, now: Date) => (isStale(row, now) && row.attempts < MAX_ATTEMPTS) || (canRetry(row) && waitedEnough(row, now));

// The viewer's own live claims that end before next Monday, soonest first: held now and not held
// any more when next week starts (lib/claims.ts's own filter, read at both moments). A person holds
// a few dozen claims at most, so they are sorted here.
const MINE_READ = 50;
async function myClaimsEnding(member: Membership, now: Date, nextStart: Date): Promise<WeeklyBriefView["mine"]> {
  return withTenant(member, async (tx) => {
    const where = {
      AND: [{ workspaceId: member.workspaceId, archivedAt: null, stage: { notIn: TERMINAL_STAGES } }, heldBy(member.userId, now), { NOT: heldBy(member.userId, nextStart) }],
    };
    const read = await tx.company.findMany({ where, select: { id: true, name: true, claimExpiresAt: true }, take: MINE_READ });
    const count = read.length < MINE_READ ? read.length : await tx.company.count({ where });
    const rows = read
      .map((r) => ({ id: r.id, name: r.name, ends: r.claimExpiresAt as Date }))
      .sort((a, b) => a.ends.getTime() - b.ends.getTime() || a.id.localeCompare(b.id))
      .slice(0, MINE_SHOWN);
    return { rows: rows.map((r) => ({ id: r.id, name: r.name, until: day(r.ends) })), count };
  });
}

const countsNow = (member: Membership, weekStart: string, clock: Clock): Promise<WeeklyCounts> =>
  readWeeklyCounts(member, weekStart, weekRanges(weekStart), { now: clock.now, todayStart: localMidnight(clock.today) });

// Whether a call could be made right now, without reserving one: Groq set up, and the gate passes
// (AI on, the 30-day limit, and more than 20 calls left).
async function callable(member: Membership): Promise<boolean> {
  if (!isConfigured("groq")) return false;
  return (await aiGate(member, "WEEKLY_BRIEF")).ok;
}

// The card for this person this week, or null when AI is off (no card, and nothing else is read).
// Makes no AI call and writes nothing. `clock` is the page's own read of the database clock.
export async function readWeeklyBrief(member: Membership, clock?: Clock): Promise<WeeklyBriefView | null> {
  const workspace = await workspaceRow(member.workspaceId);
  if (!workspace.aiEnabled) return null;
  const { now, today } = await readClock(clock);
  const weekStart = weekStartOf(today);
  const ranges = weekRanges(weekStart);

  const row = await withTenant(member, (tx) =>
    tx.weeklyBrief.findUnique({
      where: { workspaceId_weekStart: { workspaceId: member.workspaceId, weekStart } },
      select: { status: true, error: true, attempts: true, startedAt: true, facts: true, paragraphs: true, droppedSentences: true, writtenAt: true },
    }),
  );
  const mine = await myClaimsEnding(member, now, ranges.nextStart);
  const base = { weekStart, weekLabel: `Week of ${day(ranges.thisStart)}`, mine, openByDefault: isOpenByDefault(today) };

  if (row?.status === "READY") {
    const facts = storedFacts.safeParse(row.facts);
    const paragraphs = storedParagraphs.safeParse(row.paragraphs);
    if (facts.success && paragraphs.success) {
      return {
        ...base,
        state: "ready",
        paragraphs: resolveParagraphs(paragraphs.data, facts.data.facts),
        dropped: row.droppedSentences,
        lines: weeklyLines(facts.data.counts),
        writtenAt: row.writtenAt ? writtenText(row.writtenAt) : null,
      };
    }
  }

  let state: WeeklyBriefState;
  if (!row) state = "missing";
  else if (row.status === "WRITING" && !isStale(row, now)) state = "writing";
  else if (row.status !== "READY" && mayTakeOver(row, now)) state = "missing";
  else state = "code-only";
  // The browser asks for a write only when one could be made.
  if (state === "missing" && !(await callable(member))) state = "code-only";

  const lines = weeklyLines(await countsNow(member, weekStart, { now, today }));
  return { ...base, state, paragraphs: [], dropped: 0, lines, writtenAt: null };
}

// What ensureWeeklyBrief did: AI off; no call possible (code lines only); someone else is writing
// it; it is written (now or before); or this try failed.
export type EnsureOutcome = "off" | "code-only" | "writing" | "ready" | "failed";

// Writes this week's brief if nobody has, at most one call per workspace per week. Safe to call from
// every member's view at once: the unique (workspace, week) row decides who writes, and a writer
// that lost its slot (a stale take-over) stores nothing.
export async function ensureWeeklyBrief(member: Membership): Promise<EnsureOutcome> {
  // 1. Before any row is written.
  const workspace = await workspaceRow(member.workspaceId);
  if (!workspace.aiEnabled) return "off";
  if (!(await callable(member))) return "code-only";

  // 2. Take the week's slot.
  const now = await dbNow();
  const today = await dbToday();
  const weekStart = weekStartOf(today);
  const slot = await withTenant(member, async (tx): Promise<{ id: string; attempts: number } | EnsureOutcome> => {
    const { workspaceId } = member;
    await tx.weeklyBrief.deleteMany({ where: { workspaceId, weekStart: { lt: addDays(weekStart, -7 * KEEP_WEEKS) } } });
    const inserted = await tx.weeklyBrief.createMany({
      data: [{ workspaceId, weekStart, status: "WRITING", startedById: member.userId, startedAt: now, attempts: 1 }],
      skipDuplicates: true,
    });
    const row = await tx.weeklyBrief.findUniqueOrThrow({
      where: { workspaceId_weekStart: { workspaceId, weekStart } },
      select: { id: true, status: true, error: true, attempts: true, startedAt: true },
    });
    if (inserted.count === 1) return { id: row.id, attempts: row.attempts };
    if (row.status === "READY") return "ready";
    if (!mayTakeOver(row, now)) return row.status === "WRITING" ? "writing" : "failed";
    // One conditional update: of two views taking over at once, only the one whose read still
    // matches the row wins.
    const taken = await tx.weeklyBrief.updateMany({
      where: { id: row.id, workspaceId, status: row.status, attempts: row.attempts, startedAt: row.startedAt },
      data: { status: "WRITING", startedAt: now, startedById: member.userId, attempts: row.attempts + 1, error: null },
    });
    if (taken.count === 0) return "writing";
    return { id: row.id, attempts: row.attempts + 1 };
  });
  if (typeof slot === "string") return slot;

  // Stores the outcome only while this writer still holds the slot.
  const store = (data: Parameters<typeof storeRow>[2]) => storeRow(member, slot, data);

  // 3. The numbers, outside any transaction.
  const counts = await countsNow(member, weekStart, { now, today });
  const factsOnly = countFacts(counts);
  if (isQuiet(counts)) {
    await store({ status: "READY", facts: { counts, facts: factsOnly, names: {} }, paragraphs: [], droppedSentences: 0, model: null, writtenAt: await dbNow() });
    return "ready";
  }
  const verdict = await verdictFacts(member);
  const table: FactTable = { facts: [...factsOnly, ...verdict.facts], names: verdict.names };

  // 4. The one call.
  let result: Awaited<ReturnType<typeof runAi<typeof weeklyBriefReplySchema>>>;
  try {
    result = await runAi(
      member,
      { feature: "WEEKLY_BRIEF", system: WEEKLY_SYSTEM, prompt: weeklyPrompt(table), schema: weeklyBriefReplySchema },
      { accept: acceptNarrative(table, { verdictSentence: false }), messages: MESSAGES },
    );
  } catch (error) {
    console.error("weekly brief: the AI call crashed", error instanceof Error ? error.name : "unknown");
    await store({ status: "FAILED", error: "unavailable" });
    return "failed";
  }

  // 5. Store what the checks kept, or the failure's code.
  if (!result.ok) {
    await store({ status: "FAILED", error: codeOfError(result.error) });
    return "failed";
  }
  const filtered = filterNarrative(result.data, table, { verdictSentence: false });
  if (!filtered.ok) {
    await store({ status: "FAILED", error: "broke_rules" });
    return "failed";
  }
  // Counts only: a sentence can hold a template's name.
  if (filtered.dropped > 0) console.warn(`weekly brief: dropped ${filtered.dropped} sentences`);
  await store({
    status: "READY",
    facts: { counts, facts: table.facts, names: table.names },
    paragraphs: filtered.paragraphs,
    droppedSentences: filtered.dropped,
    model: result.model,
    writtenAt: await dbNow(),
  });
  return "ready";
}

type Stored =
  | { status: "READY"; facts: z.input<typeof storedFacts>; paragraphs: z.input<typeof storedParagraphs>; droppedSentences: number; model: string | null; writtenAt: Date }
  | { status: "FAILED"; error: WeeklyErrorCode };

// The write at the end of a try: only where the row is still WRITING with the attempt this writer
// took, so a late writer whose slot was taken over updates nothing. Returns the rows changed (0 or 1).
async function storeRow(member: Membership, slot: { id: string; attempts: number }, data: Stored): Promise<number> {
  const fields =
    data.status === "READY"
      ? { status: data.status, facts: data.facts, paragraphs: data.paragraphs, droppedSentences: data.droppedSentences, model: data.model, writtenAt: data.writtenAt, error: null }
      : { status: data.status, error: data.error };
  const { count } = await withTenant(member, (tx) =>
    tx.weeklyBrief.updateMany({ where: { id: slot.id, workspaceId: member.workspaceId, status: "WRITING", attempts: slot.attempts }, data: fields }),
  );
  return count;
}
