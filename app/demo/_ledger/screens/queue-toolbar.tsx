"use client";

import { useRef, type KeyboardEvent } from "react";
import { QUEUE_VIEWS, type QueueSort, type QueueView } from "@/demo/routes";
import { Count } from "./shared";
import { LedgerMenu, type MenuOption } from "./ledger-menu";
import type { QueueTotals } from "./queue-model";

// The totals line and the toolbar under the page title.
//
// The totals are one ruled ledger line: "Overdue 7  Due this week 5  Held by you 3  Never contacted 12".
// Each one is a toggle button (aria-pressed) that filters the table, and the counts follow the store.
// The toolbar holds the view tabs, the ledger-style sort menu, and the One at a time switch.

export type TotalKey = "overdue" | "week" | "mine" | "never";

export function Totals({ totals, view, overdue, onPick }: { totals: QueueTotals; view: QueueView; overdue: boolean; onPick: (key: TotalKey) => void }) {
  const items: { key: TotalKey; label: string; value: number; pressed: boolean; rust?: boolean }[] = [
    { key: "overdue", label: "Overdue", value: totals.overdue, pressed: overdue, rust: totals.overdue > 0 },
    { key: "week", label: "Due this week", value: totals.week, pressed: view === "week" },
    { key: "mine", label: "Held by you", value: totals.mine, pressed: view === "mine" },
    { key: "never", label: "Never contacted", value: totals.never, pressed: view === "never" },
  ];
  return (
    <div className="lg-totals" role="group" aria-label="Queue totals. Each one filters the list.">
      {items.map((item) => (
        <button key={item.key} type="button" className="lg-total" aria-pressed={item.pressed} onClick={() => onPick(item.key)}>
          <span className="lg-sc">{item.label}</span>
          <span className="lg-total-n" data-rust={item.rust && item.key === "overdue" ? "true" : undefined}>
            <Count value={item.value} />
          </span>
        </button>
      ))}
    </div>
  );
}

const TAB_LABELS: Record<QueueView, string> = { all: "All due", mine: "Mine", week: "This week", never: "Never contacted" };
export const TABPANEL_ID = "queue-tabpanel";

export function ViewTabs({ view, onPick }: { view: QueueView; onPick: (view: QueueView) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = QUEUE_VIEWS.indexOf(view);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % QUEUE_VIEWS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + QUEUE_VIEWS.length) % QUEUE_VIEWS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = QUEUE_VIEWS.length - 1;
    else return;
    event.preventDefault();
    onPick(QUEUE_VIEWS[next]);
    refs.current[QUEUE_VIEWS[next]]?.focus();
  };
  return (
    // The arrow keys are on the tablist, the one place a tab strip is meant to have them.
    <div role="tablist" aria-label="Queue views" className="lg-tabs-strip" onKeyDown={onKeyDown}>
      {QUEUE_VIEWS.map((key) => (
        <button
          key={key}
          ref={(el) => {
            refs.current[key] = el;
          }}
          type="button"
          role="tab"
          id={`queue-tab-${key}`}
          aria-selected={view === key}
          aria-controls={TABPANEL_ID}
          tabIndex={view === key ? 0 : -1}
          className="lg-vtab"
          onClick={() => onPick(key)}
        >
          {TAB_LABELS[key]}
        </button>
      ))}
    </div>
  );
}

const SORT_OPTIONS: readonly MenuOption<QueueSort>[] = [
  { value: "overdue", label: "Most overdue", hint: "Longest late first" },
  { value: "due", label: "Due date", hint: "Closest to today first" },
  { value: "company", label: "Company", hint: "A to Z" },
  { value: "stage", label: "Stage", hint: "Not contacted first" },
];

export function Toolbar({
  view,
  sort,
  focus,
  onView,
  onSort,
  onFocus,
}: {
  view: QueueView;
  sort: QueueSort;
  focus: boolean;
  onView: (view: QueueView) => void;
  onSort: (sort: QueueSort) => void;
  onFocus: (on: boolean) => void;
}) {
  return (
    <div className="lg-qtools">
      <ViewTabs view={view} onPick={onView} />
      <div className="lg-qtools-right">
        {!focus && <LedgerMenu label="Sort" value={sort} options={SORT_OPTIONS} onChange={onSort} align="right" />}
        <button type="button" className="lg-toggle lg-focus-toggle" aria-pressed={focus} onClick={() => onFocus(!focus)}>
          One at a time
        </button>
      </div>
    </div>
  );
}
