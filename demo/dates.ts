import type { IsoDateTime, YmdDate } from "./types";

// Date helpers for the prototypes. Everything is shown in Purdue's time zone, and every string is
// built by hand from numeric parts (never toLocaleString), so the server and the browser always
// render the exact same text. A mismatch would make React complain while hydrating.

const TIME_ZONE = "America/Indiana/Indianapolis";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

type Local = { year: number; month: number; day: number; hour: number; minute: number; second: number };

// The wall clock in West Lafayette at a moment.
export function localParts(moment: IsoDateTime | number): Local {
  const out: Record<string, number> = {};
  for (const part of zoneParts.formatToParts(new Date(moment))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out as Local;
}

const pad = (n: number) => String(n).padStart(2, "0");

// The calendar date in West Lafayette for a moment: "2026-10-28".
export function localYmd(moment: IsoDateTime | number): YmdDate {
  const { year, month, day } = localParts(moment);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// How far the zone is from UTC at a moment, in milliseconds (negative in the Americas).
function offsetMs(utcMs: number): number {
  const l = localParts(utcMs);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - Math.floor(utcMs / 1000) * 1000;
}

// A wall-clock time in West Lafayette as a UTC ISO string. zonedToIso("2026-10-28", 15) is 3 PM
// Purdue time. Midnight gives the start of that calendar day, which is how follow-up dates are stored.
export function zonedToIso(ymd: YmdDate, hour = 0, minute = 0): IsoDateTime {
  const [year, month, day] = ymd.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let utc = wall - offsetMs(wall);
  // Once more, in case the first guess landed on the other side of a daylight-saving change.
  utc = wall - offsetMs(utc);
  return new Date(utc).toISOString();
}

// A calendar date plus some days: addDaysYmd("2026-10-28", 7) is "2026-11-04". Pure date arithmetic,
// so a daylight-saving change cannot shift it.
export const addDaysYmd = (ymd: YmdDate, days: number): YmdDate =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);

// Whole calendar days from `from` to `to`. Negative when `to` is earlier.
export const daysBetweenYmd = (from: YmdDate, to: YmdDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

// A moment plus an exact number of 24-hour days, like the database's now() plus an interval.
export const addDaysToIso = (iso: IsoDateTime, days: number): IsoDateTime => new Date(Date.parse(iso) + days * MS_PER_DAY).toISOString();
export const addHoursToIso = (iso: IsoDateTime, hours: number): IsoDateTime => new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();

export const isBefore = (a: IsoDateTime, b: IsoDateTime): boolean => Date.parse(a) < Date.parse(b);
export const isAfterOrEqual = (a: IsoDateTime, b: IsoDateTime): boolean => Date.parse(a) >= Date.parse(b);

// "Oct 28"
export function formatDay(moment: IsoDateTime): string {
  const { month, day } = localParts(moment);
  return `${MONTHS[month - 1]} ${day}`;
}

// "Oct 28, 2026"
export function formatDayYear(moment: IsoDateTime): string {
  const { year, month, day } = localParts(moment);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

// "Oct 28" from a calendar date string.
export function formatYmd(ymd: YmdDate): string {
  const [, month, day] = ymd.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

// "3:00 PM"
export function formatTime(moment: IsoDateTime): string {
  const { hour, minute } = localParts(moment);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

// "Oct 28, 2026, 3:00 PM"
export const formatWhen = (moment: IsoDateTime): string => `${formatDayYear(moment)}, ${formatTime(moment)}`;

// Whole calendar days a follow-up is overdue at `now`. Zero all of the due day, negative before it.
export const daysOverdue = (followUp: IsoDateTime, now: IsoDateTime): number => daysBetweenYmd(localYmd(followUp), localYmd(now));

// "Due today", "1 day overdue", "5 days overdue" (the queue's wording).
export function overdueLabel(followUp: IsoDateTime, now: IsoDateTime): string {
  const days = daysOverdue(followUp, now);
  if (days <= 0) return "Due today";
  return days === 1 ? "1 day overdue" : `${days} days overdue`;
}

// "Due today", "Due tomorrow", "Due in 5 days", "1 day overdue", "5 days overdue".
export function dueLabel(followUp: IsoDateTime, now: IsoDateTime): string {
  const days = daysOverdue(followUp, now);
  if (days === 0) return "Due today";
  if (days === -1) return "Due tomorrow";
  if (days < 0) return `Due in ${-days} days`;
  return days === 1 ? "1 day overdue" : `${days} days overdue`;
}

// "today", "yesterday", "5 days ago", "in 3 days", by calendar day.
export function relativeDay(moment: IsoDateTime, now: IsoDateTime): string {
  const days = daysBetweenYmd(localYmd(moment), localYmd(now));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  return days > 0 ? `${days} days ago` : `in ${-days} days`;
}

// Whole days from `now` until a moment, rounded down; zero or negative once it has passed.
export const daysUntil = (moment: IsoDateTime, now: IsoDateTime): number => Math.floor((Date.parse(moment) - Date.parse(now)) / MS_PER_DAY);
