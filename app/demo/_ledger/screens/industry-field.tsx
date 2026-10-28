"use client";

import { useId } from "react";

// Industry: a free text box with the workspace's own industries as chips under it. A chip fills the
// box, and pressing the chosen one again clears it. This replaces a native datalist.
export function IndustryField({ value, onChange, suggestions, label = "Industry" }: { value: string; onChange: (value: string) => void; suggestions: string[]; label?: string }) {
  const id = useId();
  const shown = suggestions.slice(0, 6);
  return (
    <div>
      <label className="lg-label" htmlFor={`${id}-industry`}>
        {label}
      </label>
      <input id={`${id}-industry`} className="lg-input" value={value} onChange={(e) => onChange(e.target.value)} />
      {shown.length > 0 && (
        <div className="lg-industry-chips" role="group" aria-label="Industries already in this workspace">
          {shown.map((name) => {
            const on = value.trim().toLowerCase() === name.toLowerCase();
            return (
              <button key={name} type="button" className="lg-fchip lg-fchip-sm" aria-pressed={on} onClick={() => onChange(on ? "" : name)}>
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
