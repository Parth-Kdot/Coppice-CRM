// Small text helpers for AI features: masking contact details before text goes to the model,
// and checking that a quote the model returned really appears in a page of text.

// Emails and phone numbers are replaced before any text is sent to the AI (free tier).
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// 765-555-0142, (765) 555 0142, +1 765.555.0142 ...
const PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

export function maskContactDetails(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
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
