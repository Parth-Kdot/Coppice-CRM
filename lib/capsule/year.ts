import { dbToday } from "@/lib/claims";
import { addDays, dayString, localMidnight } from "@/lib/dates";
import { boardYearOf, yearLabel } from "@/lib/smart-import/dates";

// Board years, as the Time Capsule reads them. Boards turn over in July (lib/smart-import/dates.ts
// boardYearOf, the one rule the board view shares), so the board year starting in 2026 runs from
// July 1 2026 to June 30 2027, in West Lafayette's calendar. "This year" is the one the database's
// today falls in.

// How many earlier board years an owner can build a handoff for, or look back at.
export const PAST_YEARS = 5;

export type YearWindow = { start: number; label: string; from: Date; to: Date; fromDay: string; toDay: string };

// The moments a board year starts and ends: sentAt in [from, to) is in the year.
export function yearWindow(start: number): YearWindow {
  const fromDay = `${start}-07-01`;
  const toDay = `${start + 1}-07-01`;
  return { start, label: yearLabel(start), from: localMidnight(fromDay), to: localMidnight(toDay), fromDay, toDay };
}

export async function currentBoardYear(): Promise<number> {
  return boardYearOf(await dbToday());
}

// Whether an owner may build or read a handoff for this year: this one, or one of the last
// PAST_YEARS. Never a year that has not started.
export const yearAllowed = (start: number, current: number) => start <= current && start >= current - PAST_YEARS;

// "2026-11-04" for a moment, in West Lafayette's calendar.
export { dayString };

// Whole days from one calendar date to another ("2026-11-01" to "2026-11-04" is 3).
export const daysFromTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export { addDays };

// The month (1 to 12) of a moment in West Lafayette's calendar.
export const monthOf = (date: Date) => Number(dayString(date).slice(5, 7));
