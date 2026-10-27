"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DEMO_WORKSPACE_SUMMARIES } from "@/demo/data";
import { addDaysToIso, formatDay, formatDayYear } from "@/demo/dates";
import { initials } from "@/demo/rules";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions, useDemoState, useMe } from "@/demo/store";
import { useLedgerTools, useNotify } from "./providers";

// The user menu: who you are, the role switcher (view as Owner or Officer), the reviewer's demo
// tools, Reset demo and the discreet "Prototype" label. It sits at the foot of the spine, and in the
// top bar on a phone.
export function UserMenu({ ws, placement }: { ws: string; placement: "spine" | "bar" }) {
  const state = useDemoState();
  const actions = useDemoActions();
  const me = useMe(ws);
  const router = useRouter();
  const notify = useNotify();
  const { raceNext, setRaceNext } = useLedgerTools();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = me.person.name;
  const role = me.role ?? "member";

  const reset = () => {
    actions.resetDemo();
    setRaceNext(false);
    setOpen(false);
    notify("The demo is back to Oct 28, 2026.");
    const stillThere = DEMO_WORKSPACE_SUMMARIES.some((w) => w.id === ws);
    router.push(stillThere ? demoRoutes.queue(ws) : demoRoutes.workspaces());
  };

  return (
    <div className="lg-spine-user" ref={wrap}>
      <button
        type="button"
        className="lg-user-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={`${name}, ${me.roleLabel}. Open the user menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(name)}
      </button>
      {open && (
        <div id={`${id}-menu`} className={`lg-menu ${placement === "spine" ? "lg-menu-spine" : "lg-menu-bar"}`}>
          <h2>{name}</h2>
          <p className="lg-hint">{me.person.email}</p>
          <p className="mt-1 text-sm">You are {me.roleLabel}.</p>

          <div className="lg-menu-sect">
            <p className="lg-menu-title" id={`${id}-view`}>
              View as
            </p>
            <div className="lg-seg" role="group" aria-labelledby={`${id}-view`}>
              <button type="button" aria-pressed={role === "owner"} onClick={() => actions.setRole("owner", ws)}>
                Owner
              </button>
              <button type="button" aria-pressed={role === "member"} onClick={() => actions.setRole("member", ws)}>
                Officer
              </button>
            </div>
          </div>

          <div className="lg-menu-sect">
            <Link href={demoRoutes.workspaces()} className="lg-menu-item" onClick={() => setOpen(false)}>
              Switch workspace
            </Link>
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

          <div className="lg-menu-sect">
            <p className="lg-menu-title">Demo tools</p>
            <p className="lg-hint mb-1">Today is {formatDayYear(state.now)}.</p>
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
            <button type="button" className="lg-menu-item" aria-pressed={raceNext} onClick={() => setRaceNext(!raceNext)}>
              <span>A teammate wins the next Claim</span>
              <span className="lg-sc">{raceNext ? "armed" : "off"}</span>
            </button>
            <button
              type="button"
              className="lg-menu-item"
              aria-pressed={state.aiFailNext}
              onClick={() => actions.setFlags({ aiFailNext: !state.aiFailNext })}
            >
              <span>The next AI call fails</span>
              <span className="lg-sc">{state.aiFailNext ? "armed" : "off"}</span>
            </button>
            <button
              type="button"
              className="lg-menu-item"
              aria-pressed={!state.serverAiConfigured}
              onClick={() => actions.setFlags({ serverAiConfigured: !state.serverAiConfigured })}
            >
              <span>Server has no AI key</span>
              <span className="lg-sc">{state.serverAiConfigured ? "off" : "on"}</span>
            </button>
            <button type="button" className="lg-menu-item" onClick={reset}>
              Reset demo
            </button>
          </div>
          <p className="lg-proto mt-3 inline-block">Prototype</p>
        </div>
      )}
    </div>
  );
}
