"use client";

import type { KeyboardEvent } from "react";

// A number stepper: a minus button, the number, a plus button. The number is a real text field so a
// person can still type it (the settings messages for a bad number stay reachable), and the arrow
// keys step it. The buttons are labelled and stop at the limits.

export function Stepper({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  fallback,
}: {
  id: string;
  // "Claim window in days": names the field, and the buttons say Decrease or Increase before it.
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
  // The number to step from when the field holds something that is not a number.
  fallback: number;
}) {
  const parsed = Number(value);
  const current = value.trim() !== "" && Number.isFinite(parsed) ? parsed : fallback;
  const move = (delta: number) => onChange(String(Math.min(max, Math.max(min, Math.round(current) + delta))));
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(-step);
    }
  };
  return (
    <div className="lg-stepper" role="group" aria-label={label}>
      <button type="button" className="lg-stepper-btn" aria-label={`Decrease ${label.toLowerCase()}`} disabled={current <= min} onClick={() => move(-step)}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <input
        id={id}
        className="lg-stepper-num lg-num"
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
      />
      <button type="button" className="lg-stepper-btn" aria-label={`Increase ${label.toLowerCase()}`} disabled={current >= max} onClick={() => move(step)}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3.5 8h9M8 3.5v9" />
        </svg>
      </button>
    </div>
  );
}
