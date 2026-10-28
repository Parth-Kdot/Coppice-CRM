"use client";

import { useId, type ReactNode } from "react";

// A chip group: a short list of choices drawn as ruled paper chips, built on real radio inputs. The
// input is visually hidden but stays focusable, so arrow keys move through the group, Space picks, and
// the focus ring shows on the chip. Use it where a native select would sit and the list is short.

export type ChipOption<T extends string> = {
  value: T;
  label: ReactNode;
  // Read aloud instead of the label when the label alone is not enough ("In 7 days, Nov 4").
  ariaLabel?: string;
  // Extra handlers for the one chip that opens something (a date picker).
  onClick?: (event: React.MouseEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
};

export function ChipGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  className = "",
  hideLegend = false,
}: {
  legend: string;
  value: T;
  options: readonly ChipOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  hideLegend?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={`lg-chipset ${className}`}>
      <legend className={hideLegend ? "lg-sr" : "lg-label"}>{legend}</legend>
      <div className="lg-chips">
        {options.map((option) => (
          <label key={option.value} className="lg-chipx">
            <input
              ref={option.inputRef}
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              aria-label={option.ariaLabel}
              onChange={() => onChange(option.value)}
              onClick={option.onClick}
              onKeyDown={option.onKeyDown}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
