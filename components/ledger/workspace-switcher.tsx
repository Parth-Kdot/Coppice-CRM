"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { usePopover } from "./popover";

// The workspace name in the header, as a switcher: a button with a chevron that opens a small card
// listing your workspaces with your role in each (the open one ticked), then "All workspaces".
// A disclosure, not a menu: Tab walks the links (the card is drawn right after the button, fixed in
// place by usePopover, so the tab order runs straight into it). Escape closes it and puts focus back on the button;
// so do a click outside and Tab moving focus out of it.

export type WorkspaceChoice = { id: string; name: string; role: string };

export function WorkspaceSwitcher({ current, name, workspaces, variant = "head" }: { current: string; name: string; workspaces: WorkspaceChoice[]; variant?: "head" | "bar" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const card = usePopover(anchor, open, { align: "left", onDismiss: () => setOpen(false) });
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      anchor?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, anchor]);

  const onBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !wrap.current?.contains(next)) setOpen(false);
  };

  return (
    <span ref={wrap} className={`lg-wswrap lg-wswrap-${variant}`} onBlur={onBlur}>
      <button
        ref={setAnchor}
        type="button"
        className={`lg-wsswitch lg-wsswitch-${variant}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-card` : undefined}
        title={name}
        data-tour="workspace-switcher"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lg-wsswitch-name">{name}</span>
        <ChevronDownIcon size={16} className="lg-wsswitch-chev" />
        <span className="lg-sr">, switch workspace</span>
      </button>
      {open && (
          <div ref={card} id={`${id}-card`} className="lg-omenu lg-wscard">
            <p className="lg-wscard-head">Your workspaces</p>
            <ul>
              {workspaces.map((w) => {
                const here = w.id === current;
                return (
                  <li key={w.id}>
                    <Link href={`/${w.id}`} className="lg-omenu-item lg-wscard-item" aria-current={here ? "page" : undefined} onClick={() => setOpen(false)}>
                      <span className="lg-wscard-row">
                        <span className="lg-wscard-tick" aria-hidden="true">
                          {here && <CheckIcon size={16} />}
                        </span>
                        <span className="lg-omenu-label">{w.name}</span>
                      </span>
                      <span className="lg-omenu-hint lg-wscard-role">{w.role}</span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link href="/workspaces" className="lg-omenu-item lg-wscard-all" onClick={() => setOpen(false)}>
                  <span className="lg-omenu-label">All workspaces</span>
                </Link>
              </li>
            </ul>
          </div>
      )}
    </span>
  );
}
