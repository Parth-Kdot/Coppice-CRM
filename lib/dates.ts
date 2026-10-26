// Dates shown in Purdue's time zone, whatever time zone the server runs in.
const TIME_ZONE = "America/Indiana/Indianapolis";

// "Oct 25, 2026, 1:15 AM"
export const when = (date: Date) => date.toLocaleString("en-US", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

// "Oct 25"
export const day = (date: Date) => date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

// The calendar date in West Lafayette for a moment: "2026-10-25".
const localDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });

// Whole calendar days in West Lafayette from `from` to `to`: a follow-up due Nov 1 is 0 days
// overdue all of Nov 1 and 1 day on Nov 2, whatever the hour or a daylight-saving change.
export const daysBetween = (from: Date, to: Date) =>
  Math.round((Date.parse(`${localDay(to)}T00:00:00Z`) - Date.parse(`${localDay(from)}T00:00:00Z`)) / (24 * 60 * 60 * 1000));

// "Due today", "1 day overdue", "5 days overdue".
export function overdueLabel(followUp: Date, now: Date): string {
  const days = daysBetween(followUp, now);
  if (days <= 0) return "Due today";
  return days === 1 ? "1 day overdue" : `${days} days overdue`;
}

// A calendar date plus some days: addDays("2026-10-25", 7) is "2026-11-01". Pure date arithmetic
// in UTC, so daylight-saving changes can't shift it.
export const addDays = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
