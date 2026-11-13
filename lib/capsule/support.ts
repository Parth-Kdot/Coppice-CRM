import { matchKey, numbersIn } from "@/lib/ai/text";
import { monthsMentioned } from "@/lib/smart-import/dates";
import { SECTIONS, SECTION_LABELS } from "./limits";

// What ties the words of a bullet or an answer sentence to the quote or notes it cites (pure; table
// tests in tests/capsule-check.test.ts). A quote that is really in the note proves the note says
// something; these checks stop the model from adding to it: a name, a number (in digits or in
// words), a month or season, a deadline, a reversed meaning or a piece of advice the note does not
// hold. Each takes the text the model wrote and the text it may draw on (the quote, for a bullet;
// the cited notes, for a sentence). Anything the text adds that the source lacks fails it.

// Words that carry no fact of their own: never a name, never something to prove.
const STOP = new Set(
  (
    "a an and are as at be been being but by can could did do does done for from had has have her him his how i if in into is it its just may might more most much must no nor not now of off on once only or " +
    "other our out over own per same she should so some such than that the their them then there these they this those to too under until upon very was we were what when where which while who why will " +
    "with would you your also about after again before because both each here onto than through while said says asked asks told wants wanted noted mentioned"
  ).split(" "),
);

// Months are checked as months (monthsFound), so they are not names.
const MONTH_NAMES = new Set("january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec".split(" "));

const SECTION_WORDS = new Set(SECTIONS.flatMap((s) => [s, ...SECTION_LABELS[s].toLowerCase().split(/\W+/)]));

// ----- Months, the way text the model wrote is read -----

// "in May", "by May", "until May", "early May", "end of May", "mid-May": a month, not the verb.
const MAY_AS_MONTH = /\b(?:in|by|until|till|since|early|mid|late|end of|next|last)[\s-]+may\b/i;

// Every month in the text (lib/smart-import/dates.ts monthsMentioned), where a bare "may" counts
// as May only when it is written like a month: after in, by, until, early, mid, late or end of. For
// text the model wrote, a capitalised May that is not the first word counts as well, since the
// verb is not capitalised in the middle of a sentence. Notes and quotes use the lenient reading
// (a capital May in a note is as likely to be a typed "They May sponsor" as a month).
export function monthsIn(text: string, { written }: { written: boolean }): number[] {
  const months = new Set(monthsMentioned(text));
  if (MAY_AS_MONTH.test(text)) months.add(5);
  if (written) {
    const first = text.search(/\p{L}/u);
    for (const m of text.matchAll(/\bMay\b/g)) if (m.index !== undefined && m.index > first) months.add(5);
  }
  return [...months].sort((a, b) => a - b);
}

// Every month the text names is also named in `source`. A text that names no month passes.
export const monthsFound = (text: string, source: string) => {
  const known = monthsIn(source, { written: false });
  return monthsIn(text, { written: true }).every((m) => known.includes(m));
};

// ----- Numbers, in digits or in words -----

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  dozen: 12, hundred: 100, thousand: 1000, million: 1_000_000,
};
const NUMBER_WORD = new RegExp(`\\b(?:${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi");

// The figures a text holds, as lib/ai/text.ts numbersIn reads digit runs ("$2,500" is 2500), plus
// "5k" and "2.5k" (5000, 2500) and number words ("five" is 5, "dozen" is 12), so a spelled-out figure
// counts like a digit run.
export function figuresIn(text: string): string[] {
  const thousands = text.replace(/(\d[\d,]*(?:\.\d+)?)\s?k\b/gi, (_, n: string) => String(Math.round(Number(n.replace(/,/g, "")) * 1000)));
  const words = (thousands.match(NUMBER_WORD) ?? []).map((w) => String(NUMBER_WORDS[w.toLowerCase()]));
  return [...numbersIn(thousands), ...words];
}

// Every figure in the text is in `source`. A text with no figures passes.
export const numbersFound = (text: string, source: string) => {
  const known = figuresIn(source);
  return figuresIn(text).every((n) => known.includes(n));
};

// ----- Words -----

const words = (text: string) => matchKey(text).match(/\p{L}+/gu) ?? [];

// A word cut back to its root, so "confirmed", "confirmation" and "confirms" meet, and "replies"
// meets "reply". Not a dictionary: it only has to be the same for the same word in two sentences.
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ied")) return `${w.slice(0, -3)}y`;
  for (const suffix of ["ations", "ation", "ments", "ment", "ships", "ship", "ings", "ing", "ed", "es", "s", "ly"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, -suffix.length);
  }
  return w;
}

// Every capitalised word of the text except the first, the common words, the section names and the
// company's own name must be a word of `source`. This is what drops "Lucas" when the quote says
// nothing about a Lucas, and a person's name the note never gave. Returns the first word that fails,
// or null.
export function inventedName(text: string, source: string, companyNames: readonly string[]): string | null {
  const known = new Set([...words(source), ...companyNames.flatMap(words)]);
  const first = text.search(/\p{L}/u);
  for (const m of text.matchAll(/\p{Lu}\p{L}*/gu)) {
    if (m.index === first || m[0].length < 2) continue;
    const word = m[0].toLowerCase();
    if (STOP.has(word) || SECTION_WORDS.has(word) || MONTH_NAMES.has(word) || known.has(word)) continue;
    return m[0];
  }
  return null;
}

// The words of the text worth proving (four letters or more, not common words), by root.
const contentStems = (text: string) => [...new Set(words(text).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];

// At least half of the text's content words are in `sources` (the quote and its note, a cited
// note, the company's name). Stops advice the notes don't hold: "Send a gift basket" from a note
// about an invoice. A text with no content words passes.
export function wordsSupported(text: string, sources: readonly string[]): boolean {
  const mine = contentStems(text);
  if (mine.length === 0) return true;
  const known = new Set(sources.flatMap((s) => words(s).map(stem)));
  return mine.filter((w) => known.has(w)).length * 2 >= mine.length;
}

// ----- Seasons, terms and deadlines -----

const TIMING = /\b(?:fall|autumn|spring|summer|winter|semester|quarter|trimester|deadline|within|before)\b|\bq[1-4]\b|\bby (?:the )?(?:end|start|early|mid|late)\b/gi;

const hasWhen = (source: string) => monthsIn(source, { written: false }).length > 0;

// A season, term, quarter or deadline word in the text needs a date or month in `source`, or that
// same word there. Returns the first word that has neither, or null. "Before" in a quote of
// "before 3/15" and "by end of" in a quote that says "by the end of" pass.
export function unsupportedTiming(text: string, source: string): string | null {
  if (hasWhen(source)) return null;
  const flat = (t: string) => matchKey(t).replace(/\bthe /g, "");
  const haystack = flat(source);
  for (const m of text.matchAll(TIMING)) {
    const word = flat(m[0]);
    if (!new RegExp(`\\b${word}\\b`).test(haystack)) return m[0];
  }
  return null;
}

// ----- Negation -----

const NEGATION = /\b(?:never|not|no|none|nothing|nobody|without|cannot)\b|n['’]t\b/i;

// A "never", "not", "don't", "no" in the text needs one in `source`. Dropping the negation from a
// note is easy to miss; adding one reverses what it says.
export const negationFound = (text: string, source: string) => !NEGATION.test(text) || NEGATION.test(source);

// ----- The quote, as the note wrote it -----

// The stretch of `note` that a quote matches (lib/ai/text.ts matchKey: case, spacing, smart quotes
// and dashes aside), in the note's own spelling, or null when the match needs a rule a character
// by character walk can't follow (a word broken across lines with a hyphen). The quote that is
// kept and shown as proof is this stretch, so what a card says the note said is what the note says.
export function quoteSpan(quote: string, note: string): string | null {
  const key = matchKey(quote);
  if (!key) return null;
  let flat = "";
  const start: number[] = [];
  const end: number[] = [];
  let space = true;
  let at = 0;
  for (const ch of note) {
    const from = at;
    at += ch.length;
    const folded = ch
      .normalize("NFKC")
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐-―−]/g, "-")
      .toLowerCase();
    for (const c of folded) {
      const isSpace = /\s/.test(c);
      if (isSpace && space) continue;
      space = isSpace;
      const piece = isSpace ? " " : c;
      flat += piece;
      for (let i = 0; i < piece.length; i++) {
        start.push(from);
        end.push(at);
      }
    }
  }
  const index = flat.indexOf(key);
  if (index < 0) return null;
  return note.slice(start[index], end[index + key.length - 1]).replace(/\s+/g, " ").trim();
}
