// Small text helpers for AI features: masking contact details before text goes to the model,
// and checking that a quote the model returned really appears in a page of text.

import { maskInternationalPhones } from "@/lib/ai/phones";

// Emails and phone numbers are replaced before any text is sent to the AI (free tier).
// Each part is bounded (64 before the "@", 63 per label, as in RFC 5321), so a long run of word
// characters can't make the match backtrack for seconds.
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/g;

// An address written out to get past a filter: "bob at acme dot com", "bob (at) acme (dot) com",
// "bob[at]acme[dot]com", "bob @ acme . com", "bob@acme dot com". It must end in a known top-level
// domain, and every quantifier is bounded so a long run of "a at a dot a" can't backtrack for long.
// Groups: 1 is the "at" part, 2 the domain.
const SPELLED_TLD = "com|org|edu|net|io|co|us|ai|dev|app|gov|info|me|biz|uk|ca|de|in|au";
const SPELLED_AT = String.raw`\s{0,3}@\s{0,3}|\s{0,3}(?:\(\s{0,3}at\s{0,3}\)|\[\s{0,3}at\s{0,3}\]|\{\s{0,3}at\s{0,3}\})\s{0,3}|\s{1,3}at\s{1,3}`;
const SPELLED_DOT = String.raw`\s{0,3}\.\s{0,3}|\s{1,3}dot\s{1,3}|\s{0,3}(?:\(dot\)|\[dot\]|\{dot\})\s{0,3}`;
const SPELLED_EMAIL = new RegExp(
  String.raw`(?<![\w.+-])[\w.+-]{1,64}(${SPELLED_AT})((?:[\w-]{1,63}(?:${SPELLED_DOT})){1,4}(?:${SPELLED_TLD}))(?![\w-]|\.[\w-])`,
  "gi",
);
// A "dot" written out or in brackets, as opposed to a real ".".
const WRITTEN_DOT = /\sdot\s|[([{]dot[)\]}]/i;

// A bare " at " is an ordinary word, so with it the address counts only when a "dot" is written out
// too. "Register at hackpurdue.org" and "Apply at careers.acme.com" are websites and stay as they
// are, while "bob at acme dot com" is masked. "Visit us at ourclub dot org" is masked as well: a
// website written out with "dot" reads the same as an address, and packets almost always write a
// site with a real dot. A bracketed "(at)" or an "@" with spaces around it may be followed by real
// dots, so "bob (at) acme.com" and "bob @ acme.com" are masked too.
function maskSpelledEmails(text: string): string {
  return text.replace(SPELLED_EMAIL, (match, at: string, domain: string) =>
    /^\s+at\s+$/i.test(at) && !WRITTEN_DOT.test(domain) ? match : "[email]",
  );
}

// North-American numbers: 765-555-0142, (765) 555 0142, +1 765.555.0142 ...
const US_PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

// Emails (with an "@" or written out, as above), North-American phone numbers, and international
// ones that start with "+" or "00" ("+44 20 7946 0958", "0049 89 1234567"; lib/ai/phones.ts). A
// number in another country's local style ("089/1234567") is not masked here: matching it would
// also mask rows of small numbers in a packet's tables. Research page text is masked more broadly (maskPage in lib/research/scan.ts).
export function maskContactDetails(text: string): string {
  return maskInternationalPhones(maskSpelledEmails(text.replace(EMAIL, "[email]")).replace(US_PHONE, "[phone]"));
}

// Text in a form where the same words match however the PDF set them: ligatures and smart quotes
// replaced, a word broken across lines with a hyphen joined back (but never a hyphen before a digit,
// so "2025-26" stays apart from "202526"), case and spacing ignored.
export function matchKey(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/([A-Za-z])-\s*\n\s*([a-z])/g, "$1$2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// At least this many characters, so a quote can't "match" by being a common word or two.
const MIN_QUOTE = 12;

// Text from a person or a file, ready to put inside a prompt's data tags: contact details masked,
// and angle brackets swapped so the text can't close or fake the tags around it.
export const promptSafe = (text: string) => maskContactDetails(text).replace(/</g, "‹").replace(/>/g, "›");

// Whether the quote is really on the page, and every number in the fact appears in the quote.
// Both must hold: the quote proves the passage exists, the number check proves the fact didn't
// change a figure while restating it.
export function quoteFound(quote: string, pageText: string, factText: string): boolean {
  const key = matchKey(quote);
  if (key.length < MIN_QUOTE || !matchKey(pageText).includes(key)) return false;
  return numbersIn(factText).every((n) => numbersIn(quote).includes(n));
}

// "Gold tier is $2,500 for 2025" -> ["2500", "2025"].
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
}
