// Smart import's dates (lib/smart-import/): board years, and the one date written in a quote,
// read by code so the AI never supplies a number. Pure, so tests can run them directly.

// The board year a date is in, by its starting year: boards turn over in July (the board view's
// rule, components/ledger/board-year.ts), so 2026-10-25 is in 2026-27 and 2026-05-01 in 2025-26.
export const boardYearOf = (ymd: string) => (Number(ymd.slice(5, 7)) >= 7 ? Number(ymd.slice(0, 4)) : Number(ymd.slice(0, 4)) - 1);
export const yearLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_WORD = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

export type DateParts = { month: number; day: number | null; year: number | null };

// The one date written in a quote: "3/2", "3/2/26", "2026-03-02", "Mar 2", "March 2nd, 2026",
// "Aug", "Aug 2026". Null when there is no date or more than one (ambiguous), when the numbers
// can't be a month and day (13/2 might be day-first: not guessed), or for a bare "may", which is
// usually the verb.
export function parseDateText(quote: string): DateParts | null {
  const found: DateParts[] = [];
  let rest = quote;
  const take = (pattern: RegExp, read: (m: RegExpMatchArray) => DateParts) => {
    for (const m of rest.matchAll(pattern)) found.push(read(m));
    rest = rest.replace(pattern, " ");
  };
  const fullYear = (y: string | undefined) => (y === undefined ? null : y.length === 2 ? 2000 + Number(y) : Number(y));
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }));
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g, (m) => ({ month: Number(m[1]), day: Number(m[2]), year: fullYear(m[3]) }));
  take(new RegExp(`\\b(${MONTH_WORD})\\b\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b)?(?:,?\\s+(\\d{4})\\b)?`, "gi"), (m) => {
    const word = m[1].toLowerCase();
    if (word === "may" && m[2] === undefined && m[3] === undefined) return { month: -1, day: null, year: null };
    return { month: MONTHS[word], day: m[2] === undefined ? null : Number(m[2]), year: fullYear(m[3]) };
  });
  const dates = found.filter((d) => d.month !== -1);
  if (dates.length !== 1) return null;
  const [d] = dates;
  if (d.month < 1 || d.month > 12) return null;
  if (d.day !== null && (d.day < 1 || d.day > daysIn(d.year ?? 2024, d.month))) return null;
  return d;
}

// Whether a cell mentions a date at all, for describing it without its text (column suggestions).
export const hasDate = (text: string) => /\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{1,2}-\d{1,2}\b/.test(text) || new RegExp(`\\b(${MONTH_WORD})\\b`, "i").test(text.replace(/\bmay\b/gi, ""));

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const ymd = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// A calendar date for parts read from a sheet of the board year starting in `cycleStart`. Without
// a year, July to December fall in the starting year and January to June in the next. `after`
// moves a year-less date to its next occurrence after that day (a follow-up "in Aug" written
// after a contact on Mar 2 means the August after). Without a day, only a follow-up is allowed,
// and it means the 1st of the month. Null when that can't be a real date.
export function resolveDate(parts: DateParts, cycleStart: number, { after, needDay }: { after?: string; needDay: boolean }): string | null {
  if (parts.day === null && needDay) return null;
  const day = parts.day ?? 1;
  let year = parts.year ?? (parts.month >= 7 ? cycleStart : cycleStart + 1);
  if (day > daysIn(year, parts.month)) return null;
  let date = ymd(year, parts.month, day);
  if (parts.year === null && after && date < after) {
    year += 1;
    if (day > daysIn(year, parts.month)) return null;
    date = ymd(year, parts.month, day);
  }
  return date;
}

// "Mar 2, 2026", for notes and reasons a person reads.
export const longDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
