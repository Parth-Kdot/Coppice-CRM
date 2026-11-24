"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { SignOutButton } from "@/components/auth-buttons";

// The account menu: who you are, your role and claim window in one muted line, switch workspace,
// sign out. It sits at the foot of the spine; on a phone the same panel opens from the account row
// at the top of the More sheet. Everything in it is real: the name and email come from the session,
// the role and claim window from the open workspace. It closes on Escape (focus back on its
// button), on a click outside, and when Tab moves focus out of it.
export type Me = { name: string; email: string; roleLabel: string | null; claimWindowDays?: number };

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

// "Owner · claims last 14 days"
function roleLine(me: Me): string | null {
  const parts = [me.roleLabel, me.claimWindowDays ? `claims last ${me.claimWindowDays} ${me.claimWindowDays === 1 ? "day" : "days"}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function UserMenu({ me, placement, extraItems }: { me: Me; placement: "spine" | "header"; extraItems?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    // Focus left for somewhere else on the page (not to nowhere, as when the window loses focus).
    if (next && !wrap.current?.contains(next)) setOpen(false);
  };

  return (
    <div className="lg-spine-user" ref={wrap} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="lg-user-btn"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={`${me.name}${me.roleLabel ? `, ${me.roleLabel}` : ""}. Account menu`}
        data-tour="account-menu"
        onClick={() => setOpen((v) => !v)}
      >
        {initialsOf(me.name)}
      </button>
      {open && (
        <div id={`${id}-menu`} className={`lg-menu ${placement === "spine" ? "lg-menu-spine" : "lg-menu-header"}`}>
          <UserMenuPanel me={me} onClose={() => setOpen(false)} extraItems={extraItems} />
        </div>
      )}
    </div>
  );
}

// Everything in the menu, without the button: used in the popover and inside the phone's More sheet.
// `extraItems` is the slot for the onboarding tours' rows (TourMenuItems below); following a link
// there closes the menu or the sheet like the other rows.
export function UserMenuPanel({
  me,
  showName = true,
  showSwitch = true,
  onClose,
  extraItems,
}: {
  me: Me;
  showName?: boolean;
  showSwitch?: boolean;
  onClose: () => void;
  extraItems?: ReactNode;
}) {
  const line = roleLine(me);
  return (
    <div>
      {showName && (
        <>
          <p className="lg-menu-name lg-wrap-any">{me.name}</p>
          <p className="lg-menu-email">{me.email}</p>
        </>
      )}
      {line && <p className="lg-menu-email">{line}</p>}
      <div className="lg-menu-sect">
        {extraItems && (
          // A link followed inside the slot closes the menu (Enter on a link is a click too).
          <div className="contents" onClick={(event) => (event.target as Element).closest("a") && onClose()}>
            {extraItems}
          </div>
        )}
        {showSwitch && (
          <Link href="/workspaces" className="lg-menu-item" onClick={onClose}>
            Switch workspace
          </Link>
        )}
        <SignOutButton className="lg-menu-item lg-menu-quiet" />
      </div>
    </div>
  );
}

// The onboarding tours in the account menu (desktop popover and the phone's account row): replay
// the basics, and the optional AI tour, marked "recommended" with a small dot until it is taken.
// Each asks for its tour with ?tour= on the current page; tour-gate.tsx reads it and removes it.
export function TourMenuItems({ aiRecommended }: { aiRecommended: boolean }) {
  const pathname = usePathname();
  return (
    <>
      <Link href={`${pathname}?tour=basics`} className="lg-menu-item" data-tour="replay-basics">
        Replay the basics
      </Link>
      <Link href={`${pathname}?tour=ai`} className="lg-menu-item" data-tour="replay-ai">
        <span>
          AI tour
          {aiRecommended && <span className="lg-menu-hint"> · recommended</span>}
        </span>
        {aiRecommended && <span className="lg-menu-dot" aria-hidden="true" />}
      </Link>
    </>
  );
}
