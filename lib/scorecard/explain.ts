import { z } from "zod";
import type { Membership } from "@/lib/authz";
import { runAi, type AiRunError } from "@/lib/ai/run";
import { maskContactDetails } from "@/lib/ai/text";
import { mixedScriptWords, numberWordIn, RANKING } from "@/lib/ai/words";
import { dbNow } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { buildFactTable, factKeys, hasOutreach, TOO_EARLY, type Fact, type FactTable } from "@/lib/scorecard/facts";
import { factsHash } from "@/lib/scorecard/hash";
import { scorecardPrompt, SCORECARD_SYSTEM } from "@/lib/scorecard/prompt";
import { workspaceStats } from "@/lib/stats";
import type { Scorecard } from "@/lib/stats-math";
import { plain } from "@/lib/template-lab/check";
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
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|edu|net|io|co|us|ai|dev)\b/i;
const PLACEHOLDER = /\{\{|\}\}/;
// Characters with no width (a zero-width space, a joiner): taken out so they can't split a word the checks look for.
const INVISIBLE = /\p{Cf}/gu;

export type NarrativeProblemCode =
  | "segment_shape"
  | "unknown_fact"
  | "number"
  | "email"
  | "placeholder"
  | "too_long"
  | "too_few_facts"
  | "too_few_sentences";
export type NarrativeProblem = { code: NarrativeProblemCode; detail: string };

export const MIN_FACT_CHIPS = 2;
// What code says itself when the verdict is too early to tell and the model's own verdict sentence did not survive.
const VERDICT_SENTENCE_LEAD = "Right now the verdict is: ";

type Segment = ScorecardReply["paragraphs"][number]["segments"][number];
// A sentence is the run of segments up to the next [.!?]: chips sit inside sentences, and one text
// segment may end one sentence and start the next.
type Sentence = Segment[];

const ABBREVIATION = /(?<![\p{L}\p{N}])(?:vs|e\.g|i\.e|approx|etc|no)$/u;

// Text cut after each sentence end (a full stop, "?" or "!" with any closing quote, followed by a
// space or the end of the text). `ends` is true for a piece that closes a sentence.
function sentencePieces(text: string): { text: string; ends: boolean }[] {
  const pieces: { text: string; ends: boolean }[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?]+["')\]”’]*(?=\s|$)/g)) {
    // A lone full stop after a short lowercase abbreviation ("vs.", "e.g.", "etc.") does not end a sentence.
    if (m[0] === "." && ABBREVIATION.test(text.slice(0, m.index))) continue;
    const end = (m.index ?? 0) + m[0].length;
    pieces.push({ text: text.slice(start, end), ends: true });
    start = end;
  }
  if (start < text.length) pieces.push({ text: text.slice(start), ends: false });
  return pieces;
}

// A template's name in the model's words, exact and case-sensitive and not inside a longer word, is
// swapped for that name's fact chip: code knows the name, so a year or a word in a name ("Fall 2025
// pitch", "Best foot forward") is the page's own text, not the model's. The longest names go first.
const MIN_NAME_LENGTH = 3;
function nameSplitter(table: FactTable, known: ReadonlySet<string>): (text: string) => Segment[] {
  const names = Object.entries(table.names)
    .filter(([key, name]) => name.length >= MIN_NAME_LENGTH && known.has(`${key}.name`))
    .sort((a, b) => b[1].length - a[1].length);
  if (names.length === 0) return (text) => [{ text, fact: null }];
  const keyOf = new Map(names.map(([key, name]) => [name, key]));
  const escaped = names.map(([, name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  return (text) => {
    const parts: Segment[] = [];
    let at = 0;
    for (const m of text.matchAll(pattern)) {
      const index = m.index ?? 0;
      if (index > at) parts.push({ text: text.slice(at, index), fact: null });
      parts.push({ text: null, fact: `${keyOf.get(m[0])}.name` });
      at = index + m[0].length;
    }
    if (at < text.length) parts.push({ text: text.slice(at), fact: null });
    return parts;
  };
}

const wordsOf = (sentence: Sentence) => sentence.flatMap((s) => (s.text !== null ? [s.text] : [])).join(" ");
const chipsIn = (sentences: readonly Sentence[]) => sentences.reduce((n, s) => n + s.filter((x) => x.fact !== null).length, 0);

// A sentence the checks leave out: a ranking, a number in words, a link or a look-alike word, in the model's own words.
// The words are read after NFKC (fullwidth letters become plain ones), and a word that mixes scripts
// (a Cyrillic look-alike inside a Latin word) is left out too.
const badSentence = (words: string): boolean => {
  const folded = plain(words);
  return numberWordIn(folded) !== null || RANKING.test(folded) || LINK.test(folded) || mixedScriptWords(folded).length > 0;
};

export type FilteredNarrative = { paragraphs: ScorecardReply["paragraphs"]; dropped: number };
export type NarrativeFilter = ({ ok: true } & FilteredNarrative) | { ok: false; problems: NarrativeProblem[] };

// The most a stored paragraph holds once names became chips and the verdict sentence was added.
export const STORED_MAX_PARAGRAPHS = 6;
export const STORED_MAX_SEGMENTS = 60;

// The checks on the model's reply, as one pure function. Two kinds of problem:
//  - The whole reply is refused for anything that points at leaked or injected content rather than
//    clumsy phrasing: a digit, a fact key the table lacks, an email address or contact detail, a
//    placeholder, a segment that is not words or a fact, or too much text.
//  - A sentence is left out, with every segment in it (chips too), when its words hold a ranking,
//    a number written as a word, or a link. What is kept is what is stored and shown.
// Then the minimums count over what is kept: two fact chips and one whole sentence. When the verdict
// is too early to tell and the model's own verdict sentence did not survive, code adds its own.
export function filterNarrative(reply: ScorecardReply, table: FactTable): NarrativeFilter {
  const problems: NarrativeProblem[] = [];
  const known = factKeys(table);
  const splitNames = nameSplitter(table, known);
  let length = 0;

  const paragraphs: Sentence[][] = [];
  for (const paragraph of reply.paragraphs) {
    const sentences: Sentence[] = [];
    let open: Sentence = [];
    const close = () => {
      if (open.length > 0) sentences.push(open);
      open = [];
    };
    for (const segment of paragraph.segments) {
      const text = segment.text === null ? null : segment.text.replace(INVISIBLE, "");
      const hasText = text !== null && text.trim() !== "";
      // Exactly one of the two: words, or one fact key.
      if (hasText === (segment.fact !== null)) {
        problems.push({ code: "segment_shape", detail: JSON.stringify(segment) });
        continue;
      }
      if (segment.fact !== null) {
        if (!known.has(segment.fact)) problems.push({ code: "unknown_fact", detail: segment.fact });
        open.push({ text: null, fact: segment.fact });
        continue;
      }
      for (const part of splitNames(text as string)) {
        if (part.fact !== null) {
          open.push(part);
          continue;
        }
        const words = part.text as string;
        length += words.length;
        if (DIGIT.test(words)) problems.push({ code: "number", detail: words });
        if (words.includes("@") || maskContactDetails(words) !== words) problems.push({ code: "email", detail: words });
        if (PLACEHOLDER.test(words)) problems.push({ code: "placeholder", detail: words });
        for (const piece of sentencePieces(words)) {
          open.push({ text: piece.text, fact: null });
          if (piece.ends) close();
        }
      }
    }
    close();
    paragraphs.push(sentences);
  }
  if (length > SCORECARD_TEXT_MAX) problems.push({ code: "too_long", detail: String(length) });
  if (problems.length > 0) return { ok: false, problems };

  // Leave out the bad sentences, whole. A run of spaces or stray punctuation is no sentence and is
  // never counted; chips with no words around them are not a sentence either, and are left out.
  let dropped = 0;
  const keptParagraphs = paragraphs
    .map((sentences) =>
      sentences.filter((sentence) => {
        const words = wordsOf(sentence);
        const chips = sentence.some((s) => s.fact !== null);
        const hasLetters = /\p{L}/u.test(words);
        if (!chips && !hasLetters) return false;
        if (!hasLetters || badSentence(words)) {
          dropped += 1;
          return false;
        }
        return true;
      }),
    )
    .filter((sentences) => sentences.length > 0);

  const kept = keptParagraphs.flat();
  if (chipsIn(kept) < MIN_FACT_CHIPS) problems.push({ code: "too_few_facts", detail: String(chipsIn(kept)) });
  if (kept.length < 1) problems.push({ code: "too_few_sentences", detail: String(kept.length) });
  if (problems.length > 0) return { ok: false, problems };

  // The verdict is code's to state. If it is "too early to tell" and no verdict.best chip is left, code
  // adds its own sentence at the end of the last paragraph.
  const tooEarly = table.facts.some((f) => f.key === "verdict.best" && f.value === TOO_EARLY);
  if (tooEarly && !kept.some((s) => s.some((x) => x.fact === "verdict.best"))) {
    keptParagraphs[keptParagraphs.length - 1].push([
      { text: ` ${VERDICT_SENTENCE_LEAD}`, fact: null },
      { text: null, fact: "verdict.best" },
      { text: ".", fact: null },
    ]);
  }

  // Back to segments: adjacent words joined, and no space at the start of a paragraph.
  const out: ScorecardReply["paragraphs"] = [];
  for (const sentences of keptParagraphs) {
    const segments: Segment[] = [];
    for (const segment of sentences.flat()) {
      const last = segments[segments.length - 1];
      if (segment.text !== null && last && last.text !== null) last.text += segment.text;
      else segments.push({ ...segment });
    }
    if (segments[0].text !== null) segments[0].text = segments[0].text.trimStart();
    if (segments.length > STORED_MAX_SEGMENTS) return { ok: false, problems: [{ code: "segment_shape", detail: String(segments.length) }] };
    out.push({ segments });
  }
  if (out.length > STORED_MAX_PARAGRAPHS) return { ok: false, problems: [{ code: "segment_shape", detail: String(out.length) }] };
  return { ok: true, paragraphs: out, dropped };
}

// runAi's `accept` for a table: the reply passes (some of its sentences may still be left out when it
// is stored) or is logged FAILED "broke_rules".
export const acceptNarrative =
  (table: FactTable) =>
  (reply: ScorecardReply): AiRunError | null =>
    filterNarrative(reply, table).ok ? null : "broke_rules";

// ----- What is stored and what the page shows -----

const storedFacts = z.object({
  facts: z.array(z.object({ key: z.string(), value: z.union([z.number(), z.string()]), text: z.string(), what: z.string() })),
  names: z.record(z.string(), z.string()),
});

// A paragraph as the page draws it: words, and chips whose text and label come from the stored facts.
export type NarrativeSegment = { kind: "words"; text: string } | { kind: "fact"; key: string; text: string; what: string };
export type NarrativeParagraph = NarrativeSegment[];

// What is stored is the filtered reply: it may hold more paragraphs and segments than the model
// was allowed (names became chips, and code may have added its own verdict sentence).
const storedParagraphs = z.array(
  z.object({
    segments: z.array(z.object({ text: z.string().nullable(), fact: z.string().nullable() })).min(1).max(STORED_MAX_SEGMENTS),
  }),
).min(1).max(STORED_MAX_PARAGRAPHS);

export type NarrativeView = {
  id: string;
  paragraphs: NarrativeParagraph[];
  // How many sentences the checks left out before this was stored.
  dropped: number;
  model: string;
  createdAt: Date;
  createdByName: string;
};

// The segments of a stored reply with each fact key looked up in the facts it was written about.
// A key the stored facts don't hold (never from a checked reply) is left out.
export function resolveParagraphs(paragraphs: readonly { segments: readonly Segment[] }[], facts: readonly Fact[]): NarrativeParagraph[] {
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
      select: { id: true, statsHash: true, facts: true, paragraphs: true, droppedSentences: true, model: true, createdAt: true, createdBy: { select: { name: true } } },
    }),
  );
  const outreach = hasOutreach(card);
  if (!row) return { narrative: null, changed: false, hasOutreach: outreach };
  const facts = storedFacts.safeParse(row.facts);
  const stored = storedParagraphs.safeParse(row.paragraphs);
  if (!facts.success || !stored.success) return { narrative: null, changed: false, hasOutreach: outreach };
  return {
    narrative: {
      id: row.id,
      paragraphs: resolveParagraphs(stored.data, facts.data.facts),
      dropped: row.droppedSentences,
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

  // The checks decided what is kept: the paragraphs stored and shown are the filtered ones.
  const filtered = filterNarrative(result.data, table);
  if (!filtered.ok) return { ok: false, error: "The AI's answer didn't pass Coppice's checks. Try again." };
  // Counts only: a sentence can hold a template's name.
  if (filtered.dropped > 0) console.warn(`explain: dropped ${filtered.dropped} sentences`);

  const data = {
    statsHash: factsHash(table.facts),
    facts: table,
    paragraphs: filtered.paragraphs,
    droppedSentences: filtered.dropped,
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
