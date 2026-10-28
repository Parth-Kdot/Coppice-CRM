"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { addDaysToIso, formatDay, formatDayYear } from "@/demo/dates";
import { initials } from "@/demo/rules";
import { demoRoutes, matchDemoRoute } from "@/demo/routes";
import { useDemoActions, useDemoState, useMe } from "@/demo/store";
import { useResetDemo } from "./demo-tools";
import { useLedgerTools, useNotify } from "./providers";

// The user menu: who you are, switch workspace, sign out, and a Demo section that holds everything
// a reviewer needs and a real user would not: Reset demo, the Owner and Officer switch, and the
// switches that make a teammate win a claim or make the AI fail. It sits at the foot of the spine, in
// the top bar on a phone, and in the header of the workspace list (where there is no workspace yet).
// The word "prototype" appears only in the Demo section.
export function UserMenu({ ws, placement }: { ws: string | null; placement: "spine" | "bar" | "header" }) {
  const state = useDemoState();
  const actions = useDemoActions();
  const me = useMe(ws ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const notify = useNotify();
  const reset = useResetDemo(ws ?? "");
  const { raceNext, setRaceNext } = useLedgerTools();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const route = matchDemoRoute(pathname);
  const companyId = route?.screen === "company" ? route.companyId : null;

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

  const name = me.person.name;
  const role = me.role ?? "member";

  return (
    <div className="lg-spine-user" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="lg-user-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={`${name}${me.roleLabel ? `, ${me.roleLabel}` : ""}. Open the user menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(name)}
      </button>
      {open && (
        <div id={`${id}-menu`} className={`lg-menu ${placement === "spine" ? "lg-menu-spine" : "lg-menu-bar"}`}>
          <h2>{name}</h2>
          <p className="lg-hint">{me.person.email}</p>
          {me.roleLabel && <p className="mt-1 text-sm">You are {me.roleLabel}.</p>}

          <div className="lg-menu-sect">
            {ws && (
              <Link href={demoRoutes.workspaces()} className="lg-menu-item" onClick={() => setOpen(false)}>
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

          <div className="lg-menu-sect" role="group" aria-labelledby={`${id}-demo`}>
            <p className="lg-menu-title" id={`${id}-demo`}>
              Demo
            </p>
            <p className="lg-hint mb-2">This prototype runs on sample data. Today is {formatDayYear(state.now)}.</p>
            {ws && (
              <>
                <p className="lg-hint mb-1" id={`${id}-view`}>
                  View as
                </p>
                <div className="lg-seg mb-2" role="group" aria-labelledby={`${id}-view`}>
                  <button type="button" aria-pressed={role === "owner"} onClick={() => actions.setRole("owner", ws)}>
                    Owner
                  </button>
                  <button type="button" aria-pressed={role === "member"} onClick={() => actions.setRole("member", ws)}>
                    Officer
                  </button>
                </div>
              </>
            )}
            <button
              type="button"
              className="lg-menu-item"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
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
                <span>A teammate wins the next Claim</span>
                <span className="lg-sc">{raceNext ? "armed" : "off"}</span>
              </button>
            )}
            {ws && companyId && (
              <button
                type="button"
                className="lg-menu-item"
                onClick={() => {
                  actions.simulateTeammateEdit(ws, companyId, "notes", "Updated by a teammate: they asked for the 2026 packet.");
                  notify("A teammate edited the notes. Save your own change to see the conflict.");
                  setOpen(false);
                }}
              >
                A teammate edits this company&apos;s notes
              </button>
            )}
            <button type="button" className="lg-menu-item" aria-pressed={state.aiFailNext} onClick={() => actions.setFlags({ aiFailNext: !state.aiFailNext })}>
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
            {!ws && (
              <button
                type="button"
                className="lg-menu-item"
                aria-pressed={!state.canCreateWorkspace}
                onClick={() => actions.setFlags({ canCreateWorkspace: !state.canCreateWorkspace })}
              >
                <span>Hide the create form</span>
                <span className="lg-sc">{state.canCreateWorkspace ? "off" : "on"}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
