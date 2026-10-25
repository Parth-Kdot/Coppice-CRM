// Dates shown in Purdue's time zone, whatever time zone the server runs in.
const TIME_ZONE = "America/Indiana/Indianapolis";

// "Oct 25, 2026, 1:15 AM"
export const when = (date: Date) => date.toLocaleString("en-US", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

// "Oct 25"
export const day = (date: Date) => date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

// A calendar date plus some days: addDays("2026-10-25", 7) is "2026-11-01". Pure date arithmetic
// in UTC, so daylight-saving changes can't shift it.
export const addDays = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
