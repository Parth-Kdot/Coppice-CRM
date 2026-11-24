"use client";

import { useEffect, useState } from "react";

// Small shared marks: the pen-stroke check, the gilt ribbon bookmark.

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

// The double rule where one board's entries end and the next board's begin.
export function TurnoverRule({ endsYear }: { endsYear: string }) {
  return (
    <div className="lg-turnover" role="separator" aria-label={`Board of ${endsYear} ends`}>
      <span className="lg-turnover-label">Board of {endsYear} ends</span>
    </div>
  );
}

// While a draft is on its way a quill writes a wavy rule across the area: the one loop in the app,
// and only while waiting.
export function QuillWait({ label }: { label: string }) {
  return (
    <div className="lg-quill-wait" role="status">
      <svg viewBox="0 0 240 28" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
        <path pathLength={1} d="M2 15 C14 3 26 3 38 15 S62 27 74 15 S98 3 110 15 S134 27 146 15 S170 3 182 15 S206 27 218 15 S232 6 238 12" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
