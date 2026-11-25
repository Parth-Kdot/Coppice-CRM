// Small text helpers for AI features: masking contact details before text goes to the model,
// and checking that a quote the model returned really appears in a page of text.

import { maskInternationalPhones } from "@/lib/ai/phones";

// Emails and phone numbers are replaced before any text is sent to the AI (free tier).
// Each part is bounded (64 before the "@", 63 per label, as in RFC 5321), so a long run of word
// characters can't make the match backtrack for seconds.
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/g;

// An address written out to get past a filter: "bob at acme dot com", "bob (at) acme (dot) com",
// "bob[at]acme[dot]com", "bob @ acme . com", "bob@acme dot com", "dana at gmail". Every
// quantifier is bounded so a long run of "a at a dot a" can't backtrack for long. A real "." may
// stand alone or have spaces on both sides ("acme . com"), but not on one side only, so the end of a
// sentence ("hackpurdue.org. In 2025") never joins the next word to the address.
// Groups: 1 the part before the "at", 2 the "at", 3 the domain, 4 its last label when it has several.
const SPELLED_AT = String.raw`\s{0,3}@\s{0,3}|\s{0,3}(?:\(\s{0,3}at\s{0,3}\)|\[\s{0,3}at\s{0,3}\]|\{\s{0,3}at\s{0,3}\})\s{0,3}|\s{1,3}at\s{1,3}`;
const SPELLED_DOT = String.raw`\.|\s{1,3}\.\s{1,3}|\s{1,3}dot\s{1,3}|\s{0,3}(?:\(\s{0,3}dot\s{0,3}\)|\[\s{0,3}dot\s{0,3}\]|\{\s{0,3}dot\s{0,3}\})\s{0,3}`;
const LABEL = String.raw`[\w-]{1,63}`;
const SPELLED_EMAIL = new RegExp(
  String.raw`(?<![\w.+-])([\w.+-]{1,64})(${SPELLED_AT})((?:${LABEL}(?:${SPELLED_DOT})){1,4}([a-z]{2,6})|${LABEL})(?![\w-]|\.[\w-])`,
  "gi",
);
// A "dot" written out, in brackets, or a "." with spaces on both sides: never how a site is written.
const WRITTEN_DOT = /\sdot\s|[([{]\s*dot\s*[)\]}]|\s\.\s/i;
// Webmail domains, so "dana at yahoo.com" counts as an address though its dot is real. The first
// few are only ever mail, so "dana at gmail" counts with no ending at all. Yahoo, AOL and Zoho are
// left out of that list because they are also companies a club pitches ("Priya at Yahoo").
const MAIL_ONLY = new Set(["gmail", "googlemail", "hotmail", "ymail", "protonmail", "icloud"]);
const WEBMAIL = new Set([...MAIL_ONLY, "yahoo", "outlook", "aol", "proton", "msn", "gmx", "zoho", "fastmail", "live"]);
// Words that come before "at" in a sentence about a place or a site, never as the name in an
// address: "visit us at ourclub dot org", "find us @ hackpurdue.org", "we met at the dot com boom".
const NOT_A_NAME = new Set([
  "us", "me", "you", "him", "her", "them", "it", "we", "they", "i",
  "online", "here", "there", "more", "out", "up", "in", "now", "today", "tonight",
  "visit", "find", "join", "meet", "met", "see", "apply", "register", "signup", "sign", "learn",
  "look", "located", "held", "hosted", "live", "available", "starts", "start", "begins", "open", "opens",
  "arrive", "booth", "table", "and", "or", "the", "a", "an", "is", "are", "was", "be", "details", "tickets",
]);

// A bare " at " (or an "@" with spaces around it) is an ordinary word in a sentence, so with it the
// text counts as an address only when the domain is written out ("dot", brackets, "acme . com") or is
// a webmail name, and the word before it could be a name. "Register at hackpurdue.org", "Apply at
// careers.acme.com" and "visit us at ourclub dot org" are websites and stay as they are. A bracketed
// "(at)" or an "@" with no spaces is only ever an address, so "bob (at) acme.com" and "bob@acme" are
// masked whatever follows. With several labels the last may be any 2 to 6 letters, so "bob at acme
// dot xyz" is caught too. "bob at acme" with no ending is left alone: it reads like "met at noon"
// or "Priya at Acme", which name a place or an employer.
function maskSpelledEmails(text: string): string {
  return text.replace(SPELLED_EMAIL, (match, local: string, at: string, domain: string, last: string | undefined) => {
    const word = /^\s+at\s+$/i.test(at);
    const spaced = /^\s+@|@\s+$/.test(at);
    const firstLabel = domain.split(/[\s.([{]/)[0].toLowerCase();
    if (word || spaced) {
      if (NOT_A_NAME.has(local.toLowerCase())) return match;
      if (last === undefined) return MAIL_ONLY.has(firstLabel) ? "[email]" : match;
      return spaced || WRITTEN_DOT.test(domain) || WEBMAIL.has(firstLabel) ? "[email]" : match;
    }
    // "@" with no spaces, or a bracketed "at". One label alone needs a letter on both sides, so
    // "3@5" stays a price.
    if (last === undefined && !(/\p{L}/u.test(local) && /\p{L}/u.test(domain))) return match;
    return "[email]";
  });
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
