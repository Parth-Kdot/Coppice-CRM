"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

// A choice menu drawn as a ruled ledger card, used where a native select would sit (sort, filters).
// The button names the current choice; the card is a listbox of options. Arrow keys move, Enter or
// Space picks, Escape closes and returns focus to the button, Tab closes.

export type MenuOption<T extends string> = { value: T; label: string; hint?: string };

export function LedgerMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  align = "left",
  block = false,
  hideLabel = false,
}: {
  // "Sort", "Stage": printed before the current choice and used as the listbox name.
  label: string;
  value: T;
  options: readonly MenuOption<T>[];
  onChange: (value: T) => void;
  align?: "left" | "right";
  // Fill the width of its cell, with the current choice at the left and the chevron at the right.
  block?: boolean;
  // Keep the label for screen readers only, when a visible label already sits above the button.
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) items.current[active]?.focus();
  }, [open, active]);

  const openMenu = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };

  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };

  const pick = (index: number) => {
    onChange(options[index].value);
    close(true);
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`lg-lmenu ${block ? "lg-lmenu-block" : ""}`} ref={wrap}>
      <button
        ref={button}
        type="button"
        className="lg-lmenu-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className={hideLabel ? "lg-sr" : "lg-tag lg-muted"}>{label}</span>
        <span className="lg-lmenu-value">{current.label}</span>
        <ChevronDownIcon size={16} />
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className={`lg-lmenu-list ${align === "right" ? "lg-lmenu-right" : ""}`} onKeyDown={onListKey}>
          {options.map((option, i) => (
            <li
              key={option.value}
              ref={(el) => {
                items.current[i] = el;
              }}
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              className="lg-lmenu-opt"
              data-active={i === active || undefined}
              onClick={() => pick(i)}
              onMouseMove={() => setActive(i)}
            >
              <span className="lg-lmenu-tick">{option.value === value && <CheckIcon size={16} />}</span>
              <span>{option.label}</span>
              {option.hint && <span className="lg-muted lg-lmenu-hint">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
