"use client";

import { useId, useRef, useState } from "react";
import "./company.css";

// Industry: a free text box. While it has focus, the workspace's own industries that contain what
// is typed show as chips under it, so "Tech", "tech" and "Technology" don't drift apart; a chip
// fills the box. Once the box holds one of them exactly, the chips go away (there is nothing left to
// suggest), and a chip never clears the box. The box is a plain named input, so the form posts it
// like any other.
export function IndustryField({
  name = "industry",
  value,
  onChange,
  suggestions,
  maxLength,
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  maxLength?: number;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const exact = suggestions.some((s) => s.toLowerCase() === q);
  const shown = focused && !exact ? suggestions.filter((s) => !q || s.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <div
      className="lg-industry"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <label className="lg-label" htmlFor={`${id}-industry`}>
        Industry
      </label>
      <input
        ref={input}
        id={`${id}-industry`}
        name={name}
        className="lg-input"
        maxLength={maxLength}
        value={value}
        autoComplete="off"
        aria-describedby={shown.length > 0 ? `${id}-chips` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {shown.length > 0 && (
        <div id={`${id}-chips`} className="lg-industry-chips" role="group" aria-label="Industries already in this workspace">
          {shown.map((industry) => (
            <button
              key={industry}
              type="button"
              className="lg-ichip"
              // Keeps focus in the box, so the chips are still there when the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(industry);
                // The chips go away with an exact match; focus stays in the box, never on <body>.
                input.current?.focus();
              }}
            >
              {industry}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
