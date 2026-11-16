import type { Stage } from "@/generated/prisma/enums";
import { formatYmd } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";

// Small pure helpers the Time Capsule screens share (tested in tests/capsule-ui.test.ts).

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

// "November" for 11, or null for anything that is not a month.
export const monthName = (month: number): string | null => (Number.isInteger(month) && month >= 1 && month <= 12 ? MONTHS[month - 1] : null);

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// How long a reply took, in the largest whole unit that reads naturally: minutes under an hour,
// hours under two days, otherwise days.
export function spanWords(ms: number): { value: number; unit: "minute" | "hour" | "day" } {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return { value: Math.max(1, minutes), unit: "minute" };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { value: hours, unit: "hour" };
  return { value: Math.round(hours / 24), unit: "day" };
}

// The stage groups of a handoff, in the order the selection uses.
export const STAGE_ORDER: Stage[] = ["COMMITTED", "IN_CONVERSATION", "REPLIED", "CONTACTED", "NOT_CONTACTED", "DECLINED"];

export function groupByStage<T extends { stage: Stage }>(items: readonly T[]): { stage: Stage; label: string; items: T[] }[] {
  return STAGE_ORDER.flatMap((stage) => {
    const inStage = items.filter((i) => i.stage === stage);
    return inStage.length > 0 ? [{ stage, label: STAGE_LABELS[stage], items: inStage }] : [];
  });
}

// "Oct 5 to Dec 1" for a card's contact span.
export function contactSpan(first: string | null, last: string | null): string | null {
  if (!first && !last) return null;
  const f = first ? formatYmd(first.slice(0, 10)) : null;
  const l = last ? formatYmd(last.slice(0, 10)) : null;
  return f && l && f !== l ? `${f} to ${l}` : (f ?? l);
}

// "Nov 13, 2026": a day with its year, for a footnote or a published date.
export const longDay = (ymd: string) => formatYmd(ymd.slice(0, 10), { month: "short", day: "numeric", year: "numeric" });
