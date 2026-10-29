"use client";

import { useState, type KeyboardEvent } from "react";

// A number field with a minus and a plus button. The number is a real text box, so a person can
// still type it (and the server's own message for a bad number stays reachable), and the arrow keys
// step it. It submits under `name` like any input, so it sits inside a server action form.

export function Stepper({
  name,
  label,
  defaultValue,
  min,
  max,
  step = 1,
  onValue,
}: {
  name: string;
  // "Claim window in days": names the field, and the buttons say Decrease or Increase before it.
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(String(defaultValue));
  const parsed = Number(value);
  const current = value.trim() !== "" && Number.isFinite(parsed) ? parsed : defaultValue;
  const change = (next: string) => {
    setValue(next);
    onValue?.(next);
  };
  const move = (delta: number) => change(String(Math.min(max, Math.max(min, Math.round(current) + delta))));
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
          <path d="M3.500 8h9" />
        </svg>
      </button>
      <input
        name={name}
        className="lg-stepper-num lg-num"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKey}
      />
      <button type="button" className="lg-stepper-btn" aria-label={`Increase ${label.toLowerCase()}`} disabled={current >= max} onClick={() => move(step)}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3.500 8h9M8 3.500v9" />
        </svg>
      </button>
    </div>
  );
}
