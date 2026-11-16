import type { CalendarRow, OwnerView } from "@/lib/capsule";

// The handoff's six steps as plain data, and the two decisions about them the page makes on the
// server and the stepper makes in the browser (tested in tests/capsule-ui.test.ts).

export const STEPS = [
  { key: "leaving", label: "Who is leaving" },
  { key: "cards", label: "Relationship cards" },
  { key: "review", label: "Review" },
  { key: "playbook", label: "Playbook" },
  { key: "calendar", label: "Calendar" },
  { key: "publish", label: "Publish" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

// Which step to open on: the first with work left, or the last when the capsule is published.
export function firstStep(view: OwnerView | null): number {
  if (!view) return 0;
  if (view.report.status === "PUBLISHED") return 5;
  if (view.chunks.next !== null) return 1;
  if (view.counts.pending > 0 || view.counts.approved === 0) return 2;
  return 4;
}

// Calendar rows whose saved date is not on the company yet, among the ones that can take a date.
export const unappliedDates = (rows: readonly CalendarRow[]) => rows.filter((r) => !r.closed && r.date && r.date !== r.followUp).length;

