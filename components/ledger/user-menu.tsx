"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { SignOutButton } from "@/components/auth-buttons";

// The user menu: who you are, switch workspace, sign out. It sits at the foot of the spine, and in
// the More sheet on a phone. Everything in it is real: the name and email come from the session,
// and the role is the one this person holds in the open workspace.
export type Me = { name: string; email: string; roleLabel: string | null };

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

export function UserMenu({ me, placement }: { me: Me; placement: "spine" | "header" }) {
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

  return (
    <div className="lg-spine-user" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="lg-user-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={`${me.name}${me.roleLabel ? `, ${me.roleLabel}` : ""}. Open the account menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {initialsOf(me.name)}
      </button>
      {open && (
        <div id={`${id}-menu`} className={`lg-menu ${placement === "spine" ? "lg-menu-spine" : "lg-menu-header"}`}>
          <UserMenuPanel me={me} showSwitch={placement === "spine"} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

// Everything in the menu, without the button: used in the popover and inside the phone's More sheet.
export function UserMenuPanel({ me, showSwitch = true, onClose }: { me: Me; showSwitch?: boolean; onClose: () => void }) {
  return (
    <div>
      <p className="lg-menu-name">{me.name}</p>
      <p className="lg-menu-email">{me.email}</p>
      {me.roleLabel && <p className="lg-menu-email">Your role here: {me.roleLabel}</p>}
      <div className="lg-menu-sect">
        {showSwitch && (
          <Link href="/workspaces" className="lg-menu-item" onClick={onClose}>
            Switch workspace
          </Link>
        )}
        <SignOutButton className="lg-menu-item" />
      </div>
    </div>
  );
}
