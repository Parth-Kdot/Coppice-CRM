import { checkRules } from "@/lib/claim-rules";
import { matchKey, quoteFound } from "@/lib/ai/text";
import { isStale } from "@/lib/facts";
import { cleanLine, cleanQuote, fetchedHostsOf, namesPerson, PERSON_CONTACT, type CheckedPage, type Passage } from "@/lib/research/checks";
import { ASK_ID, HOOK_ID, type BriefAsk, type BriefFlag, type BriefHook, type BriefTie, type FlagKind } from "@/lib/research/sections";

// The checks on the brief's sections besides its doors (lib/research/brief.ts): campus ties, red
// flags, the outreach hook and the suggested ask. Like the doors (lib/research/checks.ts), every
// one must quote the page it cites, word for word, every number it states must be in that quote,
// it may name no person and hold no contact details, and it may name only sites that were
// fetched. Anything that fails is dropped, never repaired.

const TIES_MAX = 5;
const FLAGS_MAX = 5;
export const TIER_FACTS_MAX = 20;

// Words in a tier's name that never name a person, for namesPerson in the ask and the campus ties
// only: "Gold Tier", "Platinum Level", "Presenting Sponsor".
export const TIER_WORDS = ["tier", "tiers", "level", "levels", "package", "packages", "gold", "silver", "bronze", "platinum", "diamond", "title", "presenting"] as const;

// A campus tie must quote a campus word, so a tie is never a guess from a company's general text.
const CAMPUS_WORD = /\b(?:universit(?:y|ies)|colleges?|campus(?:es)?|alumni|alumnae|alumnus|students?|schools?|institutes?)\b/i;

// A verified fact that names a sponsorship tier or a price: a $ or USD amount, or the word tier,
// level or package.
const CURRENCY = /\$\s?\d|\bUSD\s?\d|\d\s?USD\b/i;
const TIER_WORD = /\b(?:tier|level|package)s?\b/i;

export type TierFact = { id: string; text: string };

// The verified facts the writing call may pick a suggested ask from: those that name a tier or a
// price, verified within the last year at `now` (from dbNow()), the first 20 in fact-sheet order.
// No name filter: drafts already send every verified fact to Gemini (lib/drafts.ts), and
// namesPerson would wrongly drop "Gold Tier".
export function tierFacts<F extends TierFact & { verifiedAt: Date | null; createdAt?: Date }>(facts: F[], now: Date): F[] {
  return facts
    .filter((f) => f.verifiedAt !== null && (CURRENCY.test(f.text) || TIER_WORD.test(f.text)))
    .filter((f) => !isStale({ verifiedAt: f.verifiedAt, createdAt: f.createdAt ?? now }, now))
    .slice(0, TIER_FACTS_MAX);
}

// What the writing call returns for each section (lib/research/brief-prompt.ts).
export type DraftTie = { title: string; detail: string; passage: number; quote: string };
export type DraftFlag = { kind: FlagKind; title: string; passage: number; quote: string };
export type DraftHook = { line: string; passage: number; quote: string };
export type DraftAsk = { tier: number; reason: string; passage: number; quote: string };

type Context = { passages: Passage[]; pages: Map<number, CheckedPage>; company: string };

// The page a section cites through its passage number, with its stored text, or null.
function citedPage(passage: number, { passages, pages }: Context): (CheckedPage & { text: string }) | null {
  const cited = passages[passage - 1];
  const page = cited ? pages.get(cited.page) : undefined;
  return page?.text ? (page as CheckedPage & { text: string }) : null;
}

// The checks every section shares: the quote is on the cited page and has every number the lines
// state, the lines and the quote name only fetched sites and hold no contact details, and nothing
// names a person.
function passes(quote: string, lines: string[], page: CheckedPage & { text: string }, context: Context, extraOrdinary: readonly string[] = []): boolean {
  if (lines.some((line) => !line)) return false;
  if (!quoteFound(quote, page.text, lines.join(" "))) return false;
  const hosts = fetchedHostsOf(context.pages);
  if (!lines.every((line) => cleanLine(line, hosts)) || !cleanQuote(quote, hosts)) return false;
  if (PERSON_CONTACT.test(quote)) return false;
  return ![quote, ...lines].some((line) => namesPerson(line, context.company, extraOrdinary));
}

// "Sponsored us last year": a brief never claims a history the workspace hasn't logged.
const claimsHistory = (line: string) => checkRules(line, { factNumbers: [], website: null }).some((f) => f.kind === "history");

export function checkTies(ties: DraftTie[], context: Context): BriefTie[] {
  const seen = new Set<string>();
  const kept: BriefTie[] = [];
  for (const tie of ties) {
    const page = citedPage(tie.passage, context);
    const [title, detail, quote] = [tie.title.trim(), tie.detail.trim(), tie.quote.trim()];
    if (!page || !CAMPUS_WORD.test(quote)) continue;
    if (!passes(quote, [title, detail], page, context, TIER_WORDS) || claimsHistory(`${title} ${detail}`)) continue;
    const key = matchKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id: `t${kept.length + 1}`, title, detail, page: page.position, quote });
    if (kept.length >= TIES_MAX) break;
  }
  return kept;
}

// A red flag only quotes what the page states. No date logic: "applications close March 1" is
// shown as stated, never as open or closed.
export function checkFlags(flags: DraftFlag[], context: Context): BriefFlag[] {
  const seen = new Set<string>();
  const kept: BriefFlag[] = [];
  for (const flag of flags) {
    const page = citedPage(flag.passage, context);
    const [title, quote] = [flag.title.trim(), flag.quote.trim()];
    if (!page || !passes(quote, [title], page, context)) continue;
    const key = matchKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id: `r${kept.length + 1}`, kind: flag.kind, title, page: page.position, quote });
    if (kept.length >= FLAGS_MAX) break;
  }
  return kept;
}

export function checkHook(hook: DraftHook | null, context: Context): BriefHook | null {
  if (!hook) return null;
  const page = citedPage(hook.passage, context);
  const [line, quote] = [hook.line.trim(), hook.quote.trim()];
  if (!page || !passes(quote, [line], page, context) || claimsHistory(line)) return null;
  return { id: HOOK_ID, line, page: page.position, quote };
}

// The ask names one tier fact by its number in the prompt. What is stored is that fact's id and
// its text from the database, so the tier shown is never the model's words; the model's own words
// are only the reason, and every number in it must be in its quote from the company's page.
export function checkAsk(ask: DraftAsk | null, tiers: TierFact[], context: Context): BriefAsk | null {
  if (!ask || tiers.length === 0) return null;
  const fact = Number.isInteger(ask.tier) ? tiers[ask.tier - 1] : undefined;
  const page = citedPage(ask.passage, context);
  const [reason, quote] = [ask.reason.trim(), ask.quote.trim()];
  if (!fact || !page || !passes(quote, [reason], page, context, TIER_WORDS) || claimsHistory(reason)) return null;
  return { id: ASK_ID, factId: fact.id, factText: fact.text, reason, page: page.position, quote };
}
