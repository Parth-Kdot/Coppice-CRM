// Word lists shared by the checks on model text: "Explain these numbers" (lib/scorecard/explain.ts)
// and the Template Lab (lib/template-lab/check.ts). A false positive here is cheap (one sentence
// of an explanation is left out, or one variant is dropped), so the lists are wide on purpose.

// A number written as a word: zero to twenty, the tens, hundred up to trillion, half, third, quarter,
// double, twice, thrice, triple, single, percent, dozen, couple, pair, the ordinals fourth to twentieth, and "tenfold".
export const NUMBER_WORD_SOURCE =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|trillions?|half|halves|thirds?|quarters?|doubl(?:e|es|ed|ing)|twice|tripl(?:e|es|ed|ing)|quadrupl(?:e|es|ed|ing)|percent(?:age|ages)?|dozens?|couples?|pairs?|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|single|thrice|(?:two|three|four|five|ten|hundred|thousand)fold";

// A standalone Roman numeral of two letters or more, in capitals ("IV", "XII"). One letter ("I") is a word,
// and capitalised abbreviations that happen to be spelled with numeral letters (DC, CD, CV, DM, ID, MIX)
// are not numbers. "IV" still counts.
export const ROMAN_NUMERAL_SOURCE = "(?!(?:DC|CD|MC|MD|CV|CC|DM|CI|LI|MIX|DIV|ID)\\b)(?=[IVXLCDM]{2,}\\b)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})";

const WORDS_ONLY = new RegExp(`\\b(?:${NUMBER_WORD_SOURCE})\\b`, "iu");
const WORDS_EACH = new RegExp(WORDS_ONLY.source, "giu");
// Case-sensitive: a Roman numeral is only one in capitals.
const ROMAN = new RegExp(`\\b${ROMAN_NUMERAL_SOURCE}\\b`, "u");
const ROMAN_EACH = new RegExp(ROMAN.source, "gu");

// The first number written as a word in the text (a word or a Roman numeral), or null.
export function numberWordIn(text: string): string | null {
  return WORDS_ONLY.exec(text)?.[0] ?? ROMAN.exec(text)?.[0] ?? null;
}

// Every number written as a word in the text, lower-cased, once each. A Roman numeral counts only
// in capitals, so the pronoun "I" and words such as "mix" never do.
export function numberWordsIn(text: string): string[] {
  const found = new Set<string>();
  for (const [word] of text.matchAll(WORDS_EACH)) found.add(word.toLowerCase());
  for (const [word] of text.matchAll(ROMAN_EACH)) found.add(word.toLowerCase());
  return [...found];
}

// A ranking in words: only code decides one, and it appears only as a verdict.best, verdict.worst
// or authorship.lead chip, whose words code wrote. Comparing words (higher, more, fewer, stronger)
// and recommending words (prefer, favourite, recommend) are rankings too.
export const RANKING =
  /\b(?:best|worst|tops?|topped|winners?|win|wins|winning|beats?|beating|outperform\w*|underperform\w*|outdid|eclips\w*|trump\w*|dominat\w*|falls?\s+short|above|below|instead\s+of|stands?\s+out|go-to|no\s+match|clear\s+choice|pick(?:s|ed|ing)?|outshin(?:e|es|ed|ing)|outrank(?:s|ed|ing)?|outdo(?:es|ing)?|outpac(?:e|es|ed|ing)|surpass(?:es|ed|ing)?|exceed(?:s|ed|ing)?|strong(?:er|est)|weak(?:er|est)|leading|leads?|led|lags?|lagging|trail(?:s|ed|ing)?|ahead|behind|better|worse|higher|highest|lower|lowest|more|most|less|lesser|least|fewer|fewest|greater|greatest|superior|inferior|prefer(?:s|red|ring|able|ence)?|edges?|edged|favou?rites?|recommend(?:s|ed|ing|ation|ations)?|(?:first|second)\s+place)\b/i;

// Words that mix Latin letters with letters of another script (a Cyrillic "е" in "bеst"): a look-alike
// that gets past a word check. Read on text already folded with NFKC. A word wholly in another script is
// not one. Returns each such word once.
const WORD_LETTERS = /[\p{L}\p{M}]+/gu;
const LATIN_LETTER = /\p{Script=Latin}/u;
const OTHER_LETTER = /(?!\p{Script=Latin})\p{L}/u;
export function mixedScriptWords(text: string): string[] {
  const found = new Set<string>();
  for (const [word] of text.matchAll(WORD_LETTERS)) if (LATIN_LETTER.test(word) && OTHER_LETTER.test(word)) found.add(word);
  return [...found];
}
