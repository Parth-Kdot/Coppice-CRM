import { addDays, localMidnight } from "@/lib/dates";

// The Monday brief's week: Monday 00:00 to the next Monday 00:00 in West Lafayette. Pure date
// arithmetic on calendar dates ("2026-11-23"); the date itself always comes from the database
// clock (dbToday in lib/claims.ts), never from the server's.

// 0 is Sunday and 6 is Saturday, read at noon UTC so no time zone can move the day.
const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

// The Monday that starts the week holding this date. A Sunday belongs to the week that began six days before.
export function weekStartOf(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}

// The Sunday that ends the week starting on this Monday.
export const weekEndOf = (weekStart: string) => addDays(weekStart, 6);

export type WeekRanges = {
  // The week before last, last week, this week and next week each start at one of these moments,
  // and each range runs up to (not including) the next one, so they touch with no gap.
  prevStart: Date;
  lastStart: Date;
  thisStart: Date;
  nextStart: Date;
};

export function weekRanges(weekStart: string): WeekRanges {
  return {
    prevStart: localMidnight(addDays(weekStart, -14)),
    lastStart: localMidnight(addDays(weekStart, -7)),
    thisStart: localMidnight(weekStart),
    nextStart: localMidnight(addDays(weekStart, 7)),
  };
}

// The card is open Monday to Thursday and starts collapsed Friday to Sunday.
export function isOpenByDefault(today: string): boolean {
  const weekday = weekdayOf(today);
  return weekday >= 1 && weekday <= 4;
}
