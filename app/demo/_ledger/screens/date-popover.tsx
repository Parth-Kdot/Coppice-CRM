"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { addDaysYmd } from "@/demo/dates";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";

// A small ruled calendar that opens under a chip. It is a dialog with one month of day buttons.
// Keyboard: arrow keys move by a day or a week, Home and End go to the start or end of the week,
// Page Up and Page Down change the month, Enter or Space picks, Escape closes and gives focus back.
// Every day button says its full date ("Wednesday, October 28, 2026"). Days outside the allowed
// range are disabled. Dates are plain "2026-10-28" strings, so the demo clock decides what today is.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parts = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, "0");
const make = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

// The same day of another month, or the last day of it when that month is shorter.
function shiftMonth(ymd: string, by: number): string {
  const { y, m, d } = parts(ymd);
  const index = y * 12 + (m - 1) + by;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return make(ny, nm, Math.min(d, daysIn(ny, nm)));
}

export function CalendarPopover({
  label,
  value,
  min,
  max,
  today,
  onPick,
  onClose,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  today: string;
  onPick: (ymd: string) => void;
  // restore: give focus back to the chip that opened the calendar.
  onClose: (restore: boolean) => void;
}) {
  const clamp = (ymd: string) => (ymd < min ? min : ymd > max ? max : ymd);
  const [focus, setFocus] = useState(() => clamp(value));
  const root = useRef<HTMLDivElement>(null);
  const days = useRef<Map<string, HTMLButtonElement>>(new Map());
  const moved = useRef(true);

  const { y, m } = parts(focus);
  const lead = weekday(make(y, m, 1));
  const total = daysIn(y, m);
  const cells = useMemo(() => {
    const list: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d += 1) list.push(make(y, m, d));
    while (list.length % 7 !== 0) list.push(null);
    const weeks: (string | null)[][] = [];
    for (let i = 0; i < list.length; i += 7) weeks.push(list.slice(i, i + 7));
    return weeks;
  }, [lead, total, y, m]);

  // The calendar opens under its chip. When there is less room below than its height plus the 28 px
  // status line and 8 px of air, and more room above, it opens above the chip instead.
  useLayoutEffect(() => {
    const el = root.current;
    const anchor = el?.offsetParent;
    if (!el || !anchor) return;
    const box = anchor.getBoundingClientRect();
    const need = el.getBoundingClientRect().height + 4 + 28 + 8;
    const below = window.innerHeight - box.bottom;
    if (below < need && box.top > below) el.dataset.flip = "up";
  }, []);

  // Bring the whole calendar into view when it opens inside a panel that scrolls.
  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest" });
  }, []);

  // Put focus on the day that is current, once the buttons for its month exist.
  useEffect(() => {
    if (moved.current) days.current.get(focus)?.focus();
  }, [focus]);

  const go = (next: string) => {
    moved.current = true;
    setFocus(clamp(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    const on = event.target instanceof HTMLElement && event.target.dataset.day;
    if (!on) return;
    const move: Record<string, string> = {
      ArrowLeft: addDaysYmd(focus, -1),
      ArrowRight: addDaysYmd(focus, 1),
      ArrowUp: addDaysYmd(focus, -7),
      ArrowDown: addDaysYmd(focus, 7),
      Home: addDaysYmd(focus, -weekday(focus)),
      End: addDaysYmd(focus, 6 - weekday(focus)),
      PageUp: shiftMonth(focus, -1),
      PageDown: shiftMonth(focus, 1),
    };
    if (key in move) {
      event.preventDefault();
      go(move[key]);
    }
  };

  const canPrev = make(y, m, 1) > min;
  const canNext = make(y, m, total) < max;

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={label}
      className="lg-cal"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Leaving the calendar by Tab or a click elsewhere closes it without moving focus.
        if (!root.current?.contains(event.relatedTarget as Node | null)) onClose(false);
      }}
    >
      <div className="lg-cal-head">
        <button type="button" className="lg-cal-nav" aria-label="Previous month" disabled={!canPrev} onClick={() => go(shiftMonth(focus, -1))}>
          <ChevronLeftIcon size={16} />
        </button>
        <p className="lg-cal-title" aria-live="polite">
          {MONTHS[m - 1]} {y}
        </p>
        <button type="button" className="lg-cal-nav" aria-label="Next month" disabled={!canNext} onClick={() => go(shiftMonth(focus, 1))}>
          <ChevronRightIcon size={16} />
        </button>
      </div>
      <div role="grid" aria-label={`${MONTHS[m - 1]} ${y}`} className="lg-cal-grid">
        <div role="row" className="lg-cal-row lg-cal-dow">
          {WEEKDAYS.map((name) => (
            <span key={name} role="columnheader" aria-label={name} className="lg-sc">
              {name.slice(0, 2)}
            </span>
          ))}
        </div>
        {cells.map((week, i) => (
          <div role="row" className="lg-cal-row" key={i}>
            {week.map((ymd, j) => {
              if (!ymd) return <span role="gridcell" key={j} />;
              const { d } = parts(ymd);
              const disabled = ymd < min || ymd > max;
              const full = `${WEEKDAYS[weekday(ymd)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
              return (
                <span role="gridcell" key={ymd} aria-selected={ymd === value}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) days.current.set(ymd, el);
                      else days.current.delete(ymd);
                    }}
                    data-day={ymd}
                    className="lg-cal-day"
                    data-today={ymd === today || undefined}
                    data-picked={ymd === value || undefined}
                    tabIndex={ymd === focus ? 0 : -1}
                    disabled={disabled}
                    aria-label={ymd === today ? `${full}, today` : full}
                    aria-current={ymd === today ? "date" : undefined}
                    onClick={() => onPick(ymd)}
                    onFocus={() => {
                      moved.current = false;
                      setFocus(ymd);
                    }}
                  >
                    {d}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="lg-hint lg-cal-foot">
        Arrow keys move, Enter picks, Escape closes.
      </p>
    </div>
  );
}
