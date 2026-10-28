import type { QueueFilters, QueueSort, QueueView } from "@/demo/routes";
import type { QueueRow } from "@/demo/selectors";
import { STAGES } from "@/demo/types";

// What the queue shows, worked out from every open company: the four totals, the rows of the open
// view tab in the chosen order, and the never-contacted leads. A pure function of the rows and the
// filters, so the totals and the table can never disagree.

export const WEEK_DAYS = 7;

const days = (row: QueueRow) => row.daysOverdue;
export const isDue = (row: QueueRow) => days(row) !== null && (days(row) as number) >= 0;
export const isPastDue = (row: QueueRow) => days(row) !== null && (days(row) as number) >= 1;
export const isThisWeek = (row: QueueRow) => days(row) !== null && (days(row) as number) <= 0 && (days(row) as number) >= -WEEK_DAYS;
export const isHeld = (row: QueueRow) => row.claim.state === "mine";
// A fresh lead: never contacted, no follow-up yet, and nobody else holds it.
export const isFresh = (row: QueueRow) => row.company.stage === "NOT_CONTACTED" && row.company.nextFollowUpAt === null && row.claim.state !== "theirs";

const byName = (a: QueueRow, b: QueueRow) => a.company.name.localeCompare(b.company.name) || a.company.id.localeCompare(b.company.id);
const lateness = (row: QueueRow) => (row.daysOverdue === null ? Number.NEGATIVE_INFINITY : row.daysOverdue);

const SORTERS: Record<QueueSort, (a: QueueRow, b: QueueRow) => number> = {
  // The longest overdue first, then the ones due today, then what is still ahead.
  overdue: (a, b) => lateness(b) - lateness(a) || byName(a, b),
  // The date closest to today first, whichever side of it.
  due: (a, b) => {
    const da = a.daysOverdue === null ? Number.POSITIVE_INFINITY : Math.abs(a.daysOverdue);
    const db = b.daysOverdue === null ? Number.POSITIVE_INFINITY : Math.abs(b.daysOverdue);
    return da - db || lateness(b) - lateness(a) || byName(a, b);
  },
  company: byName,
  stage: (a, b) => STAGES.indexOf(a.company.stage) - STAGES.indexOf(b.company.stage) || lateness(b) - lateness(a) || byName(a, b),
};

// Fresh leads have no date to sort by, so the default order is newest first, as before.
const FRESH_SORTERS: Record<QueueSort, (a: QueueRow, b: QueueRow) => number> = {
  ...SORTERS,
  overdue: (a, b) => Date.parse(b.company.createdAt) - Date.parse(a.company.createdAt) || a.company.id.localeCompare(b.company.id),
  due: (a, b) => Date.parse(b.company.createdAt) - Date.parse(a.company.createdAt) || a.company.id.localeCompare(b.company.id),
};

export type QueueTotals = { overdue: number; week: number; mine: number; never: number; due: number };

export type QueueModel = {
  totals: QueueTotals;
  // The rows of the open view tab, sorted. Never contacted is its own tab, so then this is the leads.
  rows: QueueRow[];
  // The fresh leads for the collapsible section under the table.
  fresh: QueueRow[];
  view: QueueView;
  overdue: boolean;
};

export function buildQueue(book: readonly QueueRow[], filters: QueueFilters): QueueModel {
  const view = filters.view;
  const totals: QueueTotals = {
    overdue: book.filter(isPastDue).length,
    week: book.filter(isThisWeek).length,
    mine: book.filter(isHeld).length,
    never: book.filter(isFresh).length,
    due: book.filter(isDue).length,
  };
  // The overdue refinement only belongs to the tabs that list dated rows or held companies.
  const overdue = filters.overdue && (view === "all" || view === "mine");
  let rows: QueueRow[];
  if (view === "never") rows = book.filter(isFresh).sort(FRESH_SORTERS[filters.sort]);
  else {
    const base = view === "mine" ? book.filter(isHeld) : view === "week" ? book.filter(isThisWeek) : book.filter(isDue);
    rows = (overdue ? base.filter(isPastDue) : base).sort(SORTERS[filters.sort]);
  }
  // Under the table, the leads; in the Mine tab only the ones I already hold.
  const fresh = view === "never" ? [] : book.filter((r) => isFresh(r) && (view !== "mine" || isHeld(r))).sort(FRESH_SORTERS[filters.sort]);
  return { totals, rows, fresh, view, overdue };
}
