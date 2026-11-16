"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";

// A small joined switch for view modes (stats All / By industry, import column swap), drawn like the
// paper chips: the active segment is the moss fill. Options with `href` are links (the mode lives in
// the URL; the picked one lights at once while the server catches up), options without are buttons
// that call onChange. The active segment carries aria-current="true"; never two at once.
//
//   <Segmented label="Split" value="all" options={[{ value: "all", label: "All" }, ...]} onChange={setSplit} />
//
// `label` names the group for screen readers (role="group"). `count` prints a muted number after
// the option's label.

type Option<T extends string> = { value: T; label: string; href?: string; count?: number };

function Pending() {
  const { pending } = useLinkStatus();
  return <span className="lg-seg-pend" data-pending={pending || undefined} aria-hidden="true" />;
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Option<T>[]; onChange?: (v: T) => void }) {
  // A link just picked lights before the URL's value arrives; a new `value` from the server wins.
  // Buttons are controlled: they light when the parent passes the new value.
  const [picked, setPicked] = useState<{ value: T; from: T } | null>(null);
  const active = picked && picked.from === value ? picked.value : value;

  return (
    <div role="group" aria-label={label} className="lg-seg">
      {options.map((option) => {
        const current = option.value === active;
        const body = (
          <>
            <span>{option.label}</span>
            {option.count !== undefined && <span className="lg-seg-count">{option.count.toLocaleString("en-US")}</span>}
          </>
        );
        if (option.href !== undefined) {
          return (
            <Link
              key={option.value}
              href={option.href}
              className="lg-seg-opt"
              aria-current={current ? "true" : undefined}
              onClick={() => {
                if (!current) setPicked({ value: option.value, from: value });
                onChange?.(option.value);
              }}
            >
              {body}
              <Pending />
            </Link>
          );
        }
        return (
          <button
            key={option.value}
            type="button"
            className="lg-seg-opt"
            aria-current={current ? "true" : undefined}
            onClick={() => {
              if (current) return;
              setPicked(null);
              onChange?.(option.value);
            }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
