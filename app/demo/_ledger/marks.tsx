"use client";

import { useEffect, useState } from "react";
import { localParts } from "@/demo/dates";

// Small shared marks: the pen-stroke check, the gilt ribbon bookmark, the board-year margin.

// A moss check mark that draws like a pen stroke: the short arm first, then the long arm, about
// 300 ms. It is one path with pathLength 1; a CSS keyframe on stroke-dashoffset runs when the class
// .lg-tick-draw is added (the class is added right after mount, so a tick that appears is drawn, and
// one that is already there at page load is drawn once too). Reduced motion shows it complete.
export function Tick({ size = 18, className = "", label, auto = true }: { size?: number; className?: string; label?: string; auto?: boolean }) {
  // auto: draws itself right after it mounts. Otherwise the parent adds .lg-tick-draw when it is time.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [auto]);
  return (
    <svg
      className={`lg-tick ${drawn ? "lg-tick-draw" : ""} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d="M4.600 10.800 8 14.200 15.600 5.800" pathLength={1} />
    </svg>
  );
}

// The gilt ribbon bookmark. It hangs from the top edge of its container; with `drop` it falls into
// place (translateY -100% to 0, 220 ms, a small overshoot). Decoration only: the claim text beside it
// always says who holds the company.
export function Ribbon({ drop = false, className = "", size = "md" }: { drop?: boolean; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`lg-ribbon lg-ribbon-${size} ${drop ? "lg-ribbon-drop" : ""} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 14 28" focusable="false">
        <path d="M0 0h14v28l-7-6.500L0 28z" fill="currentColor" />
        <path d="M3.300 0v21.200M10.700 0v21.200" stroke="rgb(246 241 230 / 0.55)" strokeWidth={0.7} fill="none" />
      </svg>
    </span>
  );
}

// The board year a date falls in. Boards turn over in July, so Oct 2026 is "26-27" and
// May 2026 is "25-26". Printed in small caps in the margin of every ledger table.
export function boardYear(iso: string): { start: number; label: string; long: string } {
  const [yearText, monthText] = localYearMonth(iso);
  const year = Number(yearText);
  const month = Number(monthText);
  const start = month >= 7 ? year : year - 1;
  const pad = (n: number) => String(n % 100).padStart(2, "0");
  return { start, label: `${pad(start)}-${pad(start + 1)}`, long: `${start}-${pad(start + 1)}` };
}

function localYearMonth(iso: string): [string, string] {
  const p = localParts(iso);
  return [String(p.year), String(p.month)];
}

export function YearMargin({ iso, className = "" }: { iso: string | null; className?: string }) {
  if (!iso) return <span className={`lg-margin ${className}`} aria-hidden="true">-</span>;
  const y = boardYear(iso);
  return (
    <span className={`lg-margin ${className}`} title={`Board of ${y.long}`}>
      <span className="sr-only">Board of {y.long}</span>
      <span aria-hidden="true">{y.label}</span>
    </span>
  );
}

// The double rule where one board's entries end and the next board's begin.
export function TurnoverRule({ endsYear }: { endsYear: string }) {
  return (
    <div className="lg-turnover" role="separator" aria-label={`Board of ${endsYear} ends`}>
      <span className="lg-turnover-label">Board of {endsYear} ends</span>
    </div>
  );
}
