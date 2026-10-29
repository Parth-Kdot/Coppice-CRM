"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRace } from "@/app/demo/_ledger/form-actions";
import { addDaysToIso, formatDay, formatDayYear } from "@/demo/dates";
import { DEMO_WORKSPACE_SUMMARIES } from "@/demo/data";
import { demoRoutes, matchDemoRoute } from "@/demo/routes";
import { useDemoActions, useDemoState } from "@/demo/store";
import { useNotify } from "./providers";
import "@/app/demo/_ledger/demo.css";

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
  const state = useDemoState();
  const actions = useDemoActions();
  const router = useRouter();
  const pathname = usePathname();
  const notify = useNotify();
  const { raceNext, setRaceNext } = useRace();
  const id = useId();
  const route = matchDemoRoute(pathname);
  const ws = route?.ws ?? null;
  const role = me.roleLabel === "Owner" ? "owner" : "member";

  const reset = () => {
    onClose();
    actions.resetDemo();
    setRaceNext(false);
    notify("The demo is back to Oct 28, 2026.");
    router.push(ws && DEMO_WORKSPACE_SUMMARIES.some((w) => w.id === ws) ? demoRoutes.queue(ws) : demoRoutes.workspaces());
  };

  return (
    <div>
      <p className="lg-menu-name">{me.name}</p>
      <p className="lg-menu-email">{me.email}</p>
      {me.roleLabel && <p className="lg-menu-email">Your role here: {me.roleLabel}</p>}
      <div className="lg-menu-sect">
        {showSwitch && (
          <Link href="/demo/workspaces" className="lg-menu-item" onClick={onClose}>
            Switch workspace
          </Link>
        )}
        <button
          type="button"
          className="lg-menu-item"
          onClick={() => {
            actions.signOut();
            router.push(demoRoutes.signIn());
          }}
        >
          Sign out
        </button>
      </div>
      <details className="lg-menu-sect lg-demo-sect" id={`${id}-demo`}>
        <summary className="lg-demo-title">Demo</summary>
        <p className="lg-demo-hint">Sample data in your browser. Today is {formatDayYear(state.now)}.</p>
        {ws && (
          <div className="lg-demo-seg" role="group" aria-label="View as">
            <button type="button" aria-pressed={role === "owner"} onClick={() => actions.setRole("owner", ws)}>
              Owner
            </button>
            <button type="button" aria-pressed={role === "member"} onClick={() => actions.setRole("member", ws)}>
              Officer
            </button>
          </div>
        )}
        <button type="button" className="lg-menu-item" onClick={reset}>
          Reset demo
        </button>
        <button
          type="button"
          className="lg-menu-item"
          onClick={() => {
            actions.advanceClock(7);
            notify(`Skipped a week. It is now ${formatDay(addDaysToIso(state.now, 7))}.`);
          }}
        >
          Skip a week
        </button>
        {ws && (
          <button type="button" className="lg-menu-item" aria-pressed={raceNext} onClick={() => setRaceNext(!raceNext)}>
            A teammate wins the next Claim: {raceNext ? "armed" : "off"}
          </button>
        )}
        <button type="button" className="lg-menu-item" aria-pressed={state.aiFailNext} onClick={() => actions.setFlags({ aiFailNext: !state.aiFailNext })}>
          The next AI call fails: {state.aiFailNext ? "armed" : "off"}
        </button>
      </details>
    </div>
  );
}
