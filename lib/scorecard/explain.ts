import { z } from "zod";
import type { Membership } from "@/lib/authz";
import { runAi, type AiRunError } from "@/lib/ai/run";
import { maskContactDetails } from "@/lib/ai/text";
import { dbNow } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { buildFactTable, factKeys, hasOutreach, type Fact, type FactTable } from "@/lib/scorecard/facts";
import { factsHash } from "@/lib/scorecard/hash";
import { scorecardPrompt, SCORECARD_SYSTEM } from "@/lib/scorecard/prompt";
import { workspaceStats } from "@/lib/stats";
import type { Scorecard } from "@/lib/stats-math";
import { SCORECARD_TEXT_MAX, scorecardReplySchema, type ActionResult, type ScorecardReply } from "@/lib/validation";

// "Explain these numbers" (AI feature 7, part 1). Code builds the fact table (lib/scorecard/facts.ts)
// and the model writes words around fact keys; code then checks the reply (below) and only a
// reply that passes is stored. The numbers on screen are chips rendered from the STORED fact
// table, so they can never be a number the model wrote. AI proposes, and nothing here changes any
// data except the one stored explanation, which a new one replaces.

// ----- The checks a reply must pass (runAi's `accept`: a reply that fails is logged FAILED broke_rules) -----

// A digit in any script, a percent sign, or any other character that is a number (a vulgar
// fraction, a superscript, a circled or Roman numeral).
const DIGIT = /\p{N}|%/u;
// A number written as a word: one to twenty, thirty, forty, fifty, hundred, half, third, quarter,
// double, twice, triple, percent, dozen (and their plurals and endings).
const NUMBER_WORD =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundreds?|half|halves|thirds?|quarters?|doubl(?:e|es|ed|ing)|twice|tripl(?:e|es|ed|ing)|percent|dozens?)\b/i;
// A ranking: only code decides one, and it appears only as a verdict.best, verdict.worst or
// authorship.lead chip, whose words code wrote.
const RANKING =
  /\b(?:best|worst|tops?|winners?|win|wins|winning|beats?|beating|outperform(?:s|ed|ing)?|strongest|weakest|leading|leads?|ahead|behind|better|worse)\b/i;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|edu|net|io|co|us|ai|dev)\b/i;
const PLACEHOLDER = /\{\{|\}\}/;

export type NarrativeProblemCode =
  | "segment_shape"
  | "unknown_fact"
  | "number"
  | "number_word"
  | "ranking_word"
  | "link"
  | "email"
  | "placeholder"
  | "too_long"
  | "too_few_facts";
export type NarrativeProblem = { code: NarrativeProblemCode; detail: string };

export const MIN_FACT_CHIPS = 2;

// Everything wrong with a reply, in the order found (empty means it passes). Pure.
export function narrativeProblems(reply: ScorecardReply, table: FactTable): NarrativeProblem[] {
  const problems: NarrativeProblem[] = [];
  const known = factKeys(table);
  let chips = 0;
  let length = 0;
  for (const paragraph of reply.paragraphs) {
    for (const { text, fact } of paragraph.segments) {
      const hasText = text !== null && text.trim() !== "";
      // Exactly one of the two: words, or one fact key.
      if (hasText === (fact !== null)) {
        problems.push({ code: "segment_shape", detail: JSON.stringify({ text, fact }) });
        continue;
      }
      if (fact !== null) {
        chips += 1;
        if (!known.has(fact)) problems.push({ code: "unknown_fact", detail: fact });
        continue;
      }
      const words = text as string;
      length += words.length;
      if (DIGIT.test(words)) problems.push({ code: "number", detail: words });
      const numberWord = NUMBER_WORD.exec(words);
      if (numberWord) problems.push({ code: "number_word", detail: numberWord[0] });
      const ranking = RANKING.exec(words);
      if (ranking) problems.push({ code: "ranking_word", detail: ranking[0] });
      if (LINK.test(words)) problems.push({ code: "link", detail: words });
      if (words.includes("@") || maskContactDetails(words) !== words) problems.push({ code: "email", detail: words });
      if (PLACEHOLDER.test(words)) problems.push({ code: "placeholder", detail: words });
    }
  }
  if (length > SCORECARD_TEXT_MAX) problems.push({ code: "too_long", detail: String(length) });
  if (chips < MIN_FACT_CHIPS) problems.push({ code: "too_few_facts", detail: String(chips) });
  return problems;
}

// runAi's `accept` for a table: the reply passes or is logged FAILED "broke_rules".
export const acceptNarrative =
  (table: FactTable) =>
  (reply: ScorecardReply): AiRunError | null =>
    narrativeProblems(reply, table).length === 0 ? null : "broke_rules";

// ----- What is stored and what the page shows -----

const storedFacts = z.object({
  facts: z.array(z.object({ key: z.string(), value: z.union([z.number(), z.string()]), text: z.string(), what: z.string() })),
  names: z.record(z.string(), z.string()),
});

// A paragraph as the page draws it: words, and chips whose text and label come from the stored facts.
export type NarrativeSegment = { kind: "words"; text: string } | { kind: "fact"; key: string; text: string; what: string };
export type NarrativeParagraph = NarrativeSegment[];

export type NarrativeView = {
  id: string;
  paragraphs: NarrativeParagraph[];
  model: string;
  createdAt: Date;
  createdByName: string;
};

// The segments of a stored reply with each fact key looked up in the facts it was written about.
// A key the stored facts don't hold (never from a checked reply) is left out.
export function resolveParagraphs(paragraphs: ScorecardReply["paragraphs"], facts: readonly Fact[]): NarrativeParagraph[] {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  return paragraphs.map((p) =>
    p.segments.flatMap((s): NarrativeSegment[] => {
      if (s.fact !== null) {
        const fact = byKey.get(s.fact);
        return fact ? [{ kind: "fact", key: fact.key, text: fact.text, what: fact.what }] : [];
      }
      return s.text ? [{ kind: "words", text: s.text }] : [];
    }),
  );
}

export type ScorecardNarrativeState = {
  // The stored explanation, or null if none has been written (or it can't be read any more).
  narrative: NarrativeView | null;
  // True when today's numbers are not the ones the stored explanation was written about.
  changed: boolean;
  // False when no outreach has been logged at all: there is nothing to explain yet.
  hasOutreach: boolean;
};

export const NOTHING_TO_EXPLAIN = "There is nothing to explain yet. Log some outreach first.";

// The stored explanation for the stats page, for every member. `stats` is the scorecard the page
// already built (split "none"), so the page reads the numbers once; without it they are read here.
export async function readNarrative(tenant: Tenant, stats?: Scorecard): Promise<ScorecardNarrativeState> {
  const card = stats ?? (await workspaceStats(tenant, "none"));
  const row = await withTenant(tenant, (tx) =>
    tx.scorecardNarrative.findUnique({
      where: { workspaceId: tenant.workspaceId },
      select: { id: true, statsHash: true, facts: true, paragraphs: true, model: true, createdAt: true, createdBy: { select: { name: true } } },
    }),
  );
  const outreach = hasOutreach(card);
  if (!row) return { narrative: null, changed: false, hasOutreach: outreach };
  const facts = storedFacts.safeParse(row.facts);
  const reply = scorecardReplySchema.safeParse({ paragraphs: row.paragraphs });
  if (!facts.success || !reply.success) return { narrative: null, changed: false, hasOutreach: outreach };
  return {
    narrative: {
      id: row.id,
      paragraphs: resolveParagraphs(reply.data.paragraphs, facts.data.facts),
      model: row.model,
      createdAt: row.createdAt,
      createdByName: row.createdBy.name,
    },
    changed: row.statsHash !== factsHash(buildFactTable(card).facts),
    hasOutreach: outreach,
  };
}

// ----- The button -----

// Asks the model to explain today's numbers, checks the reply, and stores it in place of the old
// one. Any member may. The call counts against the workspace's AI limit like any other (runAi),
// and the model is called outside any transaction.
export async function explainScorecard(member: Membership): Promise<ActionResult<ScorecardNarrativeState>> {
  const card = await workspaceStats(member, "none");
  if (!hasOutreach(card)) return { ok: false, error: NOTHING_TO_EXPLAIN };
  const table = buildFactTable(card);

  const result = await runAi(
    member,
    { feature: "SCORECARD_EXPLAIN", system: SCORECARD_SYSTEM, prompt: scorecardPrompt(table), schema: scorecardReplySchema },
    { accept: acceptNarrative(table) },
  );
  if (!result.ok) return result;

  const data = {
    statsHash: factsHash(table.facts),
    facts: table,
    paragraphs: result.data.paragraphs,
    model: result.model,
    createdById: member.userId,
    createdAt: await dbNow(),
  };
  await withTenant(member, (tx) =>
    tx.scorecardNarrative.upsert({
      where: { workspaceId: member.workspaceId },
      create: { workspaceId: member.workspaceId, ...data },
      update: data,
      select: { id: true },
    }),
  );
  return { ok: true, data: await readNarrative(member, card) };
}
