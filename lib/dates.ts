// Dates shown in Purdue's time zone, whatever time zone the server runs in.
export const TIME_ZONE = "America/Indiana/Indianapolis";

// One day in milliseconds.
export const DAY_MS = 24 * 60 * 60 * 1000;

// "Oct 25, 2026, 1:15 AM"
export const when = (date: Date) => date.toLocaleString("en-US", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

// "Oct 25"
export const day = (date: Date) => date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

// The calendar date in West Lafayette for a moment: "2026-10-25".
const localDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });

// Whole calendar days in West Lafayette from `from` to `to`: a follow-up due Nov 1 is 0 days
// overdue all of Nov 1 and 1 day on Nov 2, whatever the hour or a daylight-saving change.
export const daysBetween = (from: Date, to: Date) =>
  Math.round((Date.parse(`${localDay(to)}T00:00:00Z`) - Date.parse(`${localDay(from)}T00:00:00Z`)) / DAY_MS);

// A calendar date written as the day it names, never shifted by a time zone: "Nov 4" by default,
// or "Mar 2, 2026" and "Aug 2025" with other Intl options.
export const formatYmd = (ymd: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

// A calendar date plus some days: addDays("2026-10-25", 7) is "2026-11-01". Pure date arithmetic
// in UTC, so daylight-saving changes can't shift it.
export const addDays = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// The moment a calendar day starts in West Lafayette: localMidnight("2026-11-01") is 04:00 UTC
// (EDT). The same moment as `('2026-11-01'::date)::timestamp AT TIME ZONE ...` in lib/claims.ts,
// for code that writes a date without raw SQL (Smart import). The zone's offset is read back
// through Intl, then read again at the corrected moment in case a daylight-saving change is near.
export function localMidnight(ymd: string): Date {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const offsetAt = (t: number) => {
    const parts = format.formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - t;
  };
  const utc = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(utc - offsetAt(utc - offsetAt(utc)));
}

// "Due in 4 days" for the coming week, "Due Nov 2" after that. `days` is positive when overdue. `dueOn` is the short date ("Nov 2").
export function overdueText(days: number, dueOn?: string): string {
  if (days > 0) return days === 1 ? "1 day overdue" : `${days} days overdue`;
  if (days === 0) return "Due today";
  if (days === -1) return "Due tomorrow";
  if (days >= -7 || !dueOn) return `Due in ${-days} days`;
  return `Due ${dueOn}`;
}
