"use client";

import { useId } from "react";
import "./company.css";

// Industry: a free text box with the workspace's own industries as chips under it. A chip fills the
// box, and pressing the chosen one again clears it, so "Tech", "tech" and "Technology" don't drift
// apart. The box is a plain named input, so the form posts it like any other.
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
  const q = value.trim().toLowerCase();
  const cur = suggestions.find((s) => s.toLowerCase() === q);
  const shown = [...(cur ? [cur] : []), ...suggestions.filter((s) => s !== cur && (!q || s.toLowerCase().includes(q)))].slice(0, 8);
  return (
    <div>
      <label className="lg-label" htmlFor={`${id}-industry`}>
        Industry
      </label>
      <input id={`${id}-industry`} name={name} className="lg-input" maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
      {shown.length > 0 && (
        <div className="lg-industry-chips" role="group" aria-label="Industries already in this workspace">
          {shown.map((industry) => {
            const on = value.trim().toLowerCase() === industry.toLowerCase();
            return (
              <button key={industry} type="button" className="lg-ichip" aria-pressed={on} onClick={() => onChange(on ? "" : industry)}>
                {industry}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
