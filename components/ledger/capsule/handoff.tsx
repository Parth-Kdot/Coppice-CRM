"use client";

import { useState, type ReactNode } from "react";
import type { CalendarRow, HandoffMember, OwnerView } from "@/lib/capsule";
import { Tick } from "../marks";
import { StepCalendar } from "./step-calendar";
import { StepLeaving } from "./step-leaving";
import { StepPublish } from "./step-publish";
import { StepReading } from "./step-reading";
import { StepReview } from "./step-review";
import { STEPS, unappliedDates, type StepKey } from "./steps";

// "Hand off to next year's board": six steps an owner walks through, in order or not. The rail names
// them (numbered, with a tick on the ones that are done); only the step in hand is drawn. Each step
// has at most one main button, and Next takes that role once the step's work is done, so one
// button at a time is the main one. Back and Next never lose anything: every step saves as it goes.

export function Handoff({
  workspaceId,
  year,
  view,
  members,
  calendar,
  today,
  playbook,
  initialStep,
}: {
  workspaceId: string;
  year: { start: number; label: string };
  view: OwnerView | null;
  members: HandoffMember[];
  calendar: CalendarRow[];
  today: string;
  // The playbook page, drawn on the server.
  playbook: ReactNode;
  initialStep: number;
}) {
  const [step, setStep] = useState(initialStep);
  const locked = view?.report.status === "PUBLISHED";
  const leavingWithClaims = members.some((m) => m.departingAt && m.claims > 0);

  const done: Record<StepKey, boolean> = {
    leaving: members.some((m) => m.departingAt) && !leavingWithClaims,
    cards: !!view && view.chunks.next === null,
    review: !!view && view.counts.pending === 0 && view.counts.approved > 0,
    playbook: false,
    calendar: calendar.length > 0 && unappliedDates(calendar) === 0 && calendar.some((r) => r.followUp),
    publish: !!locked,
  };
  // Whether the step's own work is finished, so Next is the main button.
  const ready: Record<StepKey, boolean> = {
    leaving: !leavingWithClaims,
    cards: !!view && view.chunks.next === null,
    review: !!view && view.counts.pending === 0,
    playbook: true,
    calendar: unappliedDates(calendar) === 0,
    publish: true,
  };
  const current = STEPS[step];
  const go = (to: number) => setStep(Math.min(STEPS.length - 1, Math.max(0, to)));

  return (
    <div className="lg-cap-handoff" data-tour="capsule-handoff">
      <nav aria-label="Handoff steps">
        <ol className="lg-cap-steps">
          {STEPS.map((s, i) => (
            <li key={s.key} data-state={i === step ? "now" : done[s.key] ? "done" : undefined}>
              <button type="button" className="lg-cap-stepbtn" aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
                <span className="lg-cap-stepnum lg-num" aria-hidden="true">
                  {done[s.key] && i !== step ? <Tick size={14} auto={false} className="lg-tick-draw" /> : i + 1}
                </span>
                <span className="lg-cap-steplabel">{s.label}</span>
                {done[s.key] && <span className="lg-sr">, done</span>}
              </button>
            </li>
          ))}
        </ol>
        <p className="lg-cap-stepof lg-hint" aria-hidden="true">
          Step {step + 1} of {STEPS.length}: {current.label}
        </p>
      </nav>

      {locked && current.key !== "publish" && (
        <p className="lg-cap-locked" role="status">
          This handoff is published, so it is read-only. Unpublish it on the last step to change anything.
        </p>
      )}

      <div className="lg-cap-step" key={current.key}>
        {current.key === "leaving" && <StepLeaving workspaceId={workspaceId} members={members} />}
        {current.key === "cards" && <StepReading workspaceId={workspaceId} year={year} view={view} locked={!!locked} />}
        {current.key === "review" && <StepReview workspaceId={workspaceId} view={view} locked={!!locked} />}
        {current.key === "playbook" && (
          <div>
            <h3 className="lg-cap-steph">The playbook</h3>
            <p className="lg-muted lg-cap-stepsub">One page of what worked this year, made from the numbers in Template stats and the year&apos;s outreach. No AI wrote it. It goes into the capsule as it is.</p>
            {playbook}
          </div>
        )}
        {current.key === "calendar" && <StepCalendar workspaceId={workspaceId} view={view} rows={calendar} today={today} locked={!!locked} />}
        {current.key === "publish" && <StepPublish workspaceId={workspaceId} year={year} view={view} members={members} calendar={calendar} />}
      </div>

      <div className="lg-cap-stepnav">
        {step > 0 ? (
          <button type="button" className="lg-btn" onClick={() => go(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 && (
          <button id="cap-next" type="button" className={`lg-btn ${ready[current.key] ? "lg-btn-primary" : ""}`} onClick={() => go(step + 1)}>
            Next: {STEPS[step + 1].label}
          </button>
        )}
      </div>
    </div>
  );
}
