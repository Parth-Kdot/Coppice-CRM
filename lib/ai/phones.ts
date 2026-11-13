// Masking phone numbers in text, pure and with no imports, so lib/ai/text.ts (everything sent to an
// AI) and lib/research/scan.ts (page text) use one copy.

// Phone numbers in any country's format: up to 16 groups of digits joined by a space, a hyphen or
// any other dash ("765–555–0142"), a slash ("089/1234567", the usual German,
// Austrian and Swiss style), a dot before a digit, or brackets ("+44 20 7946 0958",
// "(765) 555-0142", "+91 98765 43210", "7655550142"). Digits are those of any script ("٠٥٠ ١٢٣
// ٤٥٦٧"); fullwidth ones become plain ones earlier, when the page text is tidied
// (lib/research/html.ts). A match of 7 to 15 digits (E.164's most) is masked unless it is a date
// or a run of dates and years ("2026-03-15", "15.03.2027", "12/25/2026", "2025–2026",
// "10/2026–05/2027") or, written as one bare number, too short to dial (under 10 digits). A longer
// match is never let through: it is two numbers side by side ("089 1234567 / 089 1234568"), split
// where a spaced dash or slash joins them, or a number beside a date ("15.03.2027 089 1234567"),
// which keeps the date; whatever is still longer than 15 digits is masked whole. Every repeat is
// bounded and a match can't fail once it starts, so it runs in linear time. Everything sent to an
// AI goes through this (maskContactDetails in lib/ai/text.ts).
const D = "\\p{Nd}";
const SEPARATOR = `(?: ?[-\u2010-\u2015\u2212/] ?|\\.(?=${D})| )?`;
const PHONE_LIKE = new RegExp(`\\+?\\(?${D}{1,5}\\)?(?:${SEPARATOR}\\(?${D}{1,5}\\)?){0,15}`, "gu");
const DASH = "[-./\u2010-\u2015\u2212]";
// A date, or a month and year ("10/2026"); and either of them or a year.
const FULL_DATE = `(?:${D}{4}${DASH}${D}{1,2}${DASH}${D}{1,2}|${D}{1,2}${DASH}${D}{1,2}${DASH}${D}{4}|${D}{1,2}[./](?:19|20)${D}${D})`;
const DATE_PART = `(?:${FULL_DATE}|(?:19|20)${D}${D}|${D}{1,2}[.:]${D}{2})`;
const DATES = new RegExp(`^${DATE_PART}(?:(?: ?[-/\u2010-\u2015\u2212] ?| )${DATE_PART})*$`, "u");
// Where two numbers in one long match meet: a dash or slash with a space on at least one side.
const BETWEEN = /(\s*[-/\u2010-\u2015\u2212]\s+|\s+[-/\u2010-\u2015\u2212]\s*)/u;
// A date at the start or the end of a long match, set off by a space.
const LEADING_DATE = new RegExp(`^(${FULL_DATE} )(.+)$`, "u");
const TRAILING_DATE = new RegExp(`^(.+)( ${FULL_DATE})$`, "u");

const digitCount = (text: string) => (text.match(/\p{Nd}/gu) ?? []).length;

function looksLikePhone(match: string): boolean {
  const groups = match.match(/\p{Nd}+/gu) ?? [];
  const digits = digitCount(match);
  if (digits < 7 || digits > 15) return false;
  if (DATES.test(match)) return false;
  return groups.length > 1 || match.startsWith("+") || digits >= 10;
}

// One part of a long match: its date kept, the rest masked if it looks like a phone number, and
// masked whole if it is still longer than any phone number.
function maskPart(part: string): string {
  if (digitCount(part) <= 15) return looksLikePhone(part) ? "[phone]" : part;
  if (DATES.test(part)) return part;
  const leading = LEADING_DATE.exec(part);
  if (leading) return leading[1] + maskPart(leading[2]);
  const trailing = TRAILING_DATE.exec(part);
  if (trailing) return maskPart(trailing[1]) + trailing[2];
  return "[phone]";
}

function maskMatch(match: string): string {
  if (digitCount(match) <= 15 || DATES.test(match)) return looksLikePhone(match) ? "[phone]" : match;
  // Split keeps the separators (odd places), so the text between the numbers stays as it was.
  // Split only when every piece is a whole number, a date or itself too long; otherwise the
  // pieces are fragments of numbers ("089 / 1234567 / 089 / 1234568"), and the match is masked whole.
  const pieces = match.split(BETWEEN);
  const clean = pieces.every((p, i) => i % 2 === 1 || digitCount(p) > 15 || DATES.test(p) || looksLikePhone(p));
  if (!clean) return maskPart(match);
  return pieces.map((part, i) => (i % 2 ? part : maskPart(part))).join("");
}

export function maskPhones(text: string): string {
  return text.replace(PHONE_LIKE, maskMatch);
}
