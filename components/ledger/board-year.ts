// The board year a date falls in. Boards turn over in July, so Oct 2026 is "26-27" and
// May 2026 is "25-26". Printed in the margin of every ledger table. Dates are read in Purdue's
// time zone, like every other date in the app.
export function boardYear(when: Date | string): { start: number; label: string; long: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Indiana/Indianapolis", year: "numeric", month: "numeric" }).formatToParts(new Date(when));
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const start = month >= 7 ? year : year - 1;
  const pad = (n: number) => String(n % 100).padStart(2, "0");
  return { start, label: `${pad(start)}-${pad(start + 1)}`, long: `${start}-${pad(start + 1)}` };
}
