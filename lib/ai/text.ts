// Small text helpers for AI features: masking contact details before text goes to the model,
// and checking that a quote the model returned really appears in a page of text.

import { maskPhones } from "@/lib/ai/phones";

// Emails and phone numbers are replaced before any text is sent to the AI (free tier).
// Each part is bounded (64 before the "@", 63 per label, as in RFC 5321), so a long run of word
// characters can't make the match backtrack for seconds.
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/g;

// Phone numbers in any country's format are masked too (lib/ai/phones.ts): "765-555-0142",
// "(765) 555 0142", "+1 765.555.0142", "+44 20 7946 0958", "089/1234567".
export function maskContactDetails(text: string): string {
  return maskPhones(text.replace(EMAIL, "[email]"));
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
