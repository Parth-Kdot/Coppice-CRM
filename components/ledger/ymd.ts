// Calendar dates as plain "2026-11-04" strings, the form the server's follow-up box takes. These
// helpers never touch the browser's time zone: a date is read as the day it names, in UTC.

// "Nov 4"
export function formatYmd(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
